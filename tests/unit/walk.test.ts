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

describe('walk physics headroom', () => {
  const mesh = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial());
    m.position.set(x, y + h / 2, z);
    return WalkPhysics.collider(m)!;
  };
  const floor = mesh(20, 0.2, 20, 0, -0.2, 0);

  it('climbs a low step but cannot walk into a stair flight from below', () => {
    // Low step (17 cm) at z < -1: climbable.
    const step = mesh(2, 0.17, 2, 0, 0, -2);
    // Overhead flight (underside at 1.0 m) at x > 2: must block.
    const flight = mesh(2, 0.2, 4, 3.5, 1.0, 0);
    const p = new WalkPhysics([], [floor, step, flight]);
    p.feet.set(0, 0, 0);
    for (let i = 0; i < 10; i++) p.step(new THREE.Vector3(), 0.05);
    for (let i = 0; i < 24; i++) p.step(new THREE.Vector3(0, 0, -0.085), 0.05);
    expect(p.feet.y).toBeCloseTo(0.17, 2);
    p.feet.set(0, 0, 0);
    for (let i = 0; i < 10; i++) p.step(new THREE.Vector3(), 0.05);
    for (let i = 0; i < 60; i++) p.step(new THREE.Vector3(0.085, 0, 0), 0.05);
    expect(p.feet.x).toBeLessThan(2.5 - 0.29);
    expect(p.feet.x).toBeGreaterThan(1.5);
  });
});

describe('walk physics on generated buildings', () => {
  it('climbs the generated stair to the next storey', async () => {
    const { STARTERS } = await import('@/core/generator/starters');
    for (const id of ['contemporary-office', 'scandinavian-villa']) {
      const { scene } = generateBuilding(STARTERS.find((s) => s.id === id)!.program);
      const ctx = createBuildContext(scene, () => new THREE.MeshStandardMaterial());
      const block: Collider[] = [];
      const ground: Collider[] = [];
      for (const el of scene.elements) {
        const obj = buildElementObject(el, ctx);
        const c = obj && WalkPhysics.collider(obj);
        if (!c) continue;
        if (['wall', 'window', 'column', 'box'].includes(el.type) || (el.type === 'furniture' && el.height >= 0.25 && !['rug', 'pendant_lamp'].includes(el.kind))) block.push(c);
        if (['slab', 'stair', 'terrain', 'pool', 'roof', 'box'].includes(el.type)) ground.push(c);
      }
      const stair = scene.elements.find((e) => e.type === 'stair');
      if (!stair || stair.type !== 'stair') throw new Error(`no stair in ${id}`);
      const base = scene.levels.find((l) => l.id === stair.levelId)?.elevation ?? 0;
      const dir = new THREE.Vector3(-Math.sin(stair.rotation), 0, -Math.cos(stair.rotation));
      const p = new WalkPhysics(block, ground);
      p.feet.set(stair.position.x + dir.x * 0.35, base + 0.05, stair.position.z + dir.z * 0.35);
      for (let i = 0; i < 10; i++) p.step(new THREE.Vector3(), 0.05);
      const steps = Math.ceil((stair.totalRun + 0.8) / 0.085);
      for (let i = 0; i < steps; i++) p.step(dir.clone().multiplyScalar(0.085), 0.05);
      expect(p.feet.y, id).toBeGreaterThan(base + stair.totalRise - 0.3);
    }
  });
});

describe('walk spawn', () => {
  it('settles a spawn point that overlaps the stair next to the office entrance', async () => {
    const { STARTERS } = await import('@/core/generator/starters');
    const { scene } = generateBuilding(STARTERS.find((s) => s.id === 'contemporary-office')!.program);
    const ctx = createBuildContext(scene, () => new THREE.MeshStandardMaterial());
    const block: Collider[] = [];
    const ground: Collider[] = [];
    for (const el of scene.elements) {
      const obj = buildElementObject(el, ctx);
      const c = obj && WalkPhysics.collider(obj);
      if (!c) continue;
      if (['wall', 'window', 'column', 'box'].includes(el.type)) block.push(c);
      if (['slab', 'stair', 'terrain', 'pool', 'roof', 'box'].includes(el.type)) ground.push(c);
    }
    const stair = scene.elements.find((e) => e.type === 'stair');
    if (!stair || stair.type !== 'stair') throw new Error('no stair');
    const p = new WalkPhysics(block, ground);
    // Standing half inside the flight, 1.2 m up its run.
    p.feet.set(stair.position.x + stair.width / 2 + 0.1, 0, stair.position.z - 1.2);
    for (let i = 0; i < 5; i++) p.step(new THREE.Vector3(), 0.05);
    expect(p.isClear(p.feet.x, p.feet.z)).toBe(false);
    expect(p.settle()).toBe(true);
    expect(p.isClear(p.feet.x, p.feet.z)).toBe(true);
    expect(p.feet.y).toBeLessThan(0.3);
    // And can now walk along the flight without getting stuck.
    const start = p.feet.z;
    for (let i = 0; i < 20; i++) p.step(new THREE.Vector3(0, 0, -0.085), 0.05);
    expect(start - p.feet.z).toBeGreaterThan(0.5);
    // Exactly the spawn just inside the office entrance: walking forward must work.
    p.feet.set(stair.position.x + stair.width / 2 + 0.1, 0, stair.position.z - 0.8);
    for (let i = 0; i < 5; i++) p.step(new THREE.Vector3(), 0.05);
    p.settle();
    const z0 = p.feet.z;
    for (let i = 0; i < 20; i++) p.step(new THREE.Vector3(0, 0, -0.085), 0.05);
    expect(z0 - p.feet.z).toBeGreaterThan(1.5);
  });
});

describe('walking through doors', () => {
  it.each(['scandinavian-villa', 'contemporary-office'])('%s: the entrance opens on approach, lets the walker in, and the eye never touches geometry', async (starterId) => {
    const { STARTERS } = await import('@/core/generator/starters');
    const { collectDoorParts, animateDoors } = await import('@/core/geometry/doorMotion');
    const { pointAlongWall, wallFrame, findElement } = await import('@/core/scene/query');
    const { scene } = generateBuilding(STARTERS.find((s) => s.id === starterId)!.program);
    const ctx = createBuildContext(scene, () => new THREE.MeshStandardMaterial());
    const block: Collider[] = [];
    const ground: Collider[] = [];
    const solid: Collider[] = [];
    const doorObjs = new Map<string, { obj: THREE.Object3D; box: THREE.Box3 }>();
    for (const el of scene.elements) {
      const obj = buildElementObject(el, ctx);
      const c = obj && WalkPhysics.collider(obj);
      if (!c) continue;
      if (el.type !== 'room') solid.push(el.type === 'door' ? { obj: c.obj, box: c.box.clone().expandByScalar(1.1) } : c);
      if (['wall', 'window', 'column', 'box'].includes(el.type)) block.push(c);
      if (['slab', 'stair', 'terrain', 'pool', 'roof', 'box'].includes(el.type)) ground.push(c);
      if (el.type === 'door') doorObjs.set(el.id, c);
    }
    // The main (exterior) entrance door.
    const door = scene.elements.find((e) => e.type === 'door' && (findElement(scene, e.hostId) as { exterior?: boolean })?.exterior && e.doorType !== 'opening');
    if (!door || door.type !== 'door') throw new Error('no exterior door');
    const host = findElement(scene, door.hostId);
    if (!host || host.type !== 'wall') throw new Error('no host');
    const p = pointAlongWall(host, door.offset);
    const n = wallFrame(host).normal;
    const parts = collectDoorParts(doorObjs.get(door.id)!.obj, doorObjs.get(door.id)!.box);
    expect(parts.length).toBeGreaterThan(0);

    const walkThrough = (open: boolean) => {
      for (const d of parts) {
        d.t = 0;
      }
      const phys = new WalkPhysics(block, ground, solid);
      // The wall normal of the generated façade points into the building.
      // Start 1.5 m outside the door, walk 3.4 m straight through it.
      phys.feet.set(p.x - n.x * 1.5, 0.05, p.z - n.z * 1.5);
      for (let i = 0; i < 10; i++) phys.step(new THREE.Vector3(), 0.05);
      const dir = new THREE.Vector3(n.x, 0, n.z).multiplyScalar(0.085);
      let minClear = Infinity;
      for (let i = 0; i < 40; i++) {
        if (open) animateDoors(parts, phys.feet, 0.05);
        phys.step(dir, 0.05);
        // Eye clearance holds at every step.
        expect(phys.eyeClear(phys.feet.x, phys.feet.y, phys.feet.z)).toBe(true);
        minClear = Math.min(minClear, Math.hypot(phys.feet.x - p.x, phys.feet.z - p.z));
      }
      // Signed distance past the wall plane (positive = inside).
      return (phys.feet.x - p.x) * n.x + (phys.feet.z - p.z) * n.z;
    };
    const passedClosed = walkThrough(false);
    const passedOpen = walkThrough(true);
    expect(passedClosed).toBeLessThan(0); // a closed leaf stops the eye outside
    expect(passedOpen).toBeGreaterThan(1); // an opened door lets you walk in
    expect(parts.every((d) => d.t > 0.9 || d.t === 0)).toBe(true);
  });
});
