import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { generateBuilding } from '@/core/generator/generateBuilding';
import { buildElementObject, createBuildContext } from '@/core/geometry/build3d';
import { WalkPhysics, type Collider } from '@/core/geometry/walkPhysics';

describe('first-person walk physics', () => {
  const { scene } = generateBuilding({ kind: 'room', blocks: [{ width: 6, depth: 4 }], floorHeight: 2.7, windows: { count: 0 }, doors: { count: 0 } });
  const ctx = createBuildContext(scene, () => new THREE.MeshStandardMaterial());
  const block: Collider[] = [];
  const ground: Collider[] = [];
  for (const el of scene.elements) {
    const obj = buildElementObject(el, ctx);
    const c = obj && WalkPhysics.collider(obj);
    if (!c) continue;
    if (el.type === 'wall') block.push(c);
    if (el.type === 'slab' || el.type === 'terrain') ground.push(c);
  }

  it('lands on the floor and is stopped by walls', () => {
    const p = new WalkPhysics(block, ground);
    p.feet.set(0, 1, 0);
    for (let i = 0; i < 60; i++) p.step(new THREE.Vector3(), 0.05);
    expect(p.onGround).toBe(true);
    expect(p.feet.y).toBeGreaterThan(-0.2);
    expect(p.feet.y).toBeLessThan(0.4);
    // Walk north (towards z = -2) for 4 s: must stop inside the room.
    for (let i = 0; i < 80; i++) p.step(new THREE.Vector3(0, 0, -1.7 * 0.05), 0.05);
    expect(p.feet.z).toBeLessThan(-1);
    expect(p.feet.z).toBeGreaterThan(-2);
    // Walk east: stops before the east wall at x = 3.
    for (let i = 0; i < 80; i++) p.step(new THREE.Vector3(1.7 * 0.05, 0, 0), 0.05);
    expect(p.feet.x).toBeGreaterThan(2);
    expect(p.feet.x).toBeLessThan(3);
  });
});
