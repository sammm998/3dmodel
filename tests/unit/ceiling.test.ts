import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { generateBuilding } from '@/core/generator/generateBuilding';
import { STARTERS } from '@/core/generator/starters';
import { buildElementObject, createBuildContext } from '@/core/geometry/build3d';
describe('slabs', () => {
 it('show a painted ceiling (facing down) under upper floors', () => {
  const { scene } = generateBuilding(STARTERS[0].program);
  const ctx = createBuildContext(scene, (id) => Object.assign(new THREE.MeshStandardMaterial(), { name: String(id) }));
  const up = scene.levels.find((l) => l.elevation > 1)!; const slab = scene.elements.find((e) => e.type === 'slab' && e.levelId === up.id)!;
  const o = buildElementObject(slab, ctx)!; o.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3((slab as any).polygon[0].x * 0.5 + (slab as any).polygon[2].x * 0.5, 0.5, (slab as any).polygon[0].z * 0.5 + (slab as any).polygon[2].z * 0.5), new THREE.Vector3(0, 1, 0));
  const hit = ray.intersectObject(o, true)[0];
  expect(((hit.object as THREE.Mesh).material as THREE.Material).name).toBe('paint_white');
  expect(hit.face!.normal.y).toBeCloseTo(-1, 5);
 });
});
