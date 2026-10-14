import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyOperations } from '@/core/ops/apply';
import { emptyScene } from '@/core/schema/scene';
import { buildElementObject, createBuildContext } from '@/core/geometry/build3d';
import { ferrisWheelOps } from '@/core/samples/ferrisWheel';
import type { BeamElement, BoxElement } from '@/core/schema/elements';

const mat = (id: string) => Object.assign(new THREE.MeshStandardMaterial(), { name: id });

describe('solids', () => {
  it.each(['box', 'cylinder', 'sphere', 'cone', 'torus', 'capsule'] as const)('%s fills its bounding box above its base point', (shape) => {
    const r = applyOperations(emptyScene(), [{ op: 'create', element: { type: 'box', shape, position: { x: 2, y: 0.5, z: -1 }, width: 2, height: 3, depth: shape === 'torus' ? 0.3 : 1.5, thickness: 0.3, cornerRadius: 0.2 } }]);
    expect(r.ok, r.errors.join()).toBe(true);
    const el = r.scene.elements[0];
    const o = buildElementObject(el, createBuildContext(r.scene, mat))!;
    o.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(o);
    expect(b.min.y).toBeCloseTo(0.5, 2);
    expect(b.max.y).toBeCloseTo(3.5, 2);
    expect(b.max.x - b.min.x).toBeCloseTo(2, 1);
    expect((b.min.x + b.max.x) / 2).toBeCloseTo(2, 2);
  });

  it('tilts about the centre: a cylinder laid along Z', () => {
    const r = applyOperations(emptyScene(), [{ op: 'create', element: { type: 'box', shape: 'cylinder', position: { x: 0, y: 1, z: 0 }, width: 0.5, depth: 0.5, height: 4, tiltX: Math.PI / 2 } }]);
    const o = buildElementObject(r.scene.elements[0], createBuildContext(r.scene, mat))!;
    o.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(o);
    expect(b.max.z - b.min.z).toBeCloseTo(4, 2);
    expect((b.min.y + b.max.y) / 2).toBeCloseTo(3, 2);
  });
});

describe('array', () => {
  it('repeats in a row and round a vertical axis', () => {
    const r = applyOperations(emptyScene(), [
      { op: 'create', ref: '$c', element: { type: 'column', position: { x: 5, z: 0 }, width: 0.4, depth: 0.4, height: 3, shape: 'round' } },
      { op: 'array', id: '$c', count: 8, radial: { center: { x: 0, z: 0 }, axis: 'y' } },
      { op: 'create', ref: '$b', element: { type: 'box', position: { x: 0, y: 0, z: 10 }, width: 1, depth: 1, height: 1 } },
      { op: 'array', id: '$b', count: 5, step: { x: 2 } },
    ]);
    expect(r.ok, r.errors.join()).toBe(true);
    const cols = r.scene.elements.filter((e) => e.type === 'column');
    expect(cols).toHaveLength(8);
    for (const c of cols) expect(Math.hypot((c as { position: { x: number; z: number } }).position.x, (c as { position: { x: number; z: number } }).position.z)).toBeCloseTo(5, 3);
    const boxes = r.scene.elements.filter((e): e is BoxElement => e.type === 'box');
    expect(boxes.map((b) => b.position.x)).toEqual([0, 2, 4, 6, 8]);
  });

  it('builds a detailed Ferris wheel: spokes on the rim, gondolas hanging level under it', () => {
    const r = applyOperations(emptyScene(), ferrisWheelOps({ x: 0, z: 0 }, { radius: 8, gondolas: 16 }));
    expect(r.ok, r.errors.join()).toBe(true);
    const hub = { x: 0, y: 11 };
    const spokes = r.scene.elements.filter((e): e is BeamElement => e.type === 'beam' && e.name.startsWith('Spoke'));
    expect(spokes).toHaveLength(64);
    for (const s of spokes) expect(Math.hypot(s.end.x - hub.x, s.end.y - hub.y)).toBeCloseTo(8, 3);
    const cabins = r.scene.elements.filter((e): e is BoxElement => e.type === 'box' && /^Gondola( \d+)?$/.test(e.name));
    const hangers = r.scene.elements.filter((e): e is BeamElement => e.type === 'beam' && e.name.startsWith('Gondola hanger'));
    expect(cabins).toHaveLength(16);
    for (const c of cabins) {
      // Level (not turned with the wheel) and straight under a hanger that starts on the rim.
      expect(c.rotation).toBe(0);
      expect(c.tiltZ).toBe(0);
      const h = hangers.find((x) => Math.abs(x.end.x - c.position.x) < 1e-3 && Math.abs(x.end.y - (c.position.y + 1.9)) < 1e-3);
      expect(h).toBeTruthy();
      expect(Math.hypot(h!.start.x - hub.x, h!.start.y - hub.y)).toBeCloseTo(8, 3);
    }
    // Everything builds.
    const ctx = createBuildContext(r.scene, mat);
    for (const e of r.scene.elements) expect(buildElementObject(e, ctx), e.name).toBeTruthy();
    expect(r.scene.elements.length).toBeGreaterThan(150);
  });
});
