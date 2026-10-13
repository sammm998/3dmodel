import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { generateBuilding } from '@/core/generator/generateBuilding';
import { buildElementObject, buildSceneGroup, createBuildContext } from '@/core/geometry/build3d';
import { applyOperations } from '@/core/ops/apply';
import type { WallElement, WindowElement } from '@/core/schema/elements';

const mat = () => new THREE.MeshStandardMaterial();

function bbox(o: THREE.Object3D) {
  o.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(o);
}

describe('parametric geometry', () => {
  const { scene } = generateBuilding({ kind: 'room', blocks: [{ width: 6, depth: 4 }], floorHeight: 2.7, windows: { count: 2 }, doors: { count: 1 } });

  it('builds walls with the right dimensions in world space', () => {
    const ctx = createBuildContext(scene, mat);
    const north = scene.elements.find((e) => e.type === 'wall' && e.name.startsWith('North')) as WallElement;
    const b = bbox(buildElementObject(north, ctx)!);
    // Butt-jointed corners: 6 m ± a half-thickness depending on which wall covers the corner.
    expect([6 - 0.25, 6 + 0.25].some((l) => Math.abs(b.max.x - b.min.x - l) < 1e-3)).toBe(true);
    expect(b.max.y - b.min.y).toBeCloseTo(2.7, 3);
    expect((b.max.z + b.min.z) / 2).toBeCloseTo(-2, 3);
  });

  it('closes corners exactly: no gaps and no overlapping (z-fighting) volumes', () => {
    const ctx = createBuildContext(scene, mat);
    const walls = scene.elements.filter((e): e is WallElement => e.type === 'wall');
    // Wall bodies without their openings (boxes only measure extents).
    const boxes = walls.map((w) => bbox(buildElementObject(w, ctx)!));
    const union = boxes.reduce((u, b) => u.union(b), new THREE.Box3());
    expect(union.max.x - union.min.x).toBeCloseTo(6.25, 3);
    expect(union.max.z - union.min.z).toBeCloseTo(4.25, 3);
    const volume = boxes.reduce((v, b) => v + (b.max.x - b.min.x) * (b.max.y - b.min.y) * (b.max.z - b.min.z), 0);
    expect(volume).toBeCloseTo((6.25 * 4.25 - 5.75 * 3.75) * 2.7, 3);
  });

  it('trims interior walls at T-junctions to the inner face of the exterior wall', async () => {
    const { STARTERS } = await import('@/core/generator/starters');
    const villa = generateBuilding(STARTERS.find((s) => s.id === 'scandinavian-villa')!.program).scene;
    const vctx = createBuildContext(villa, mat);
    const exterior = villa.elements.filter((e): e is WallElement => e.type === 'wall' && !!e.exterior);
    const interior = villa.elements.filter((e): e is WallElement => e.type === 'wall' && !e.exterior);
    expect(interior.length).toBeGreaterThan(3);
    for (const w of interior) {
      const ib = bbox(buildElementObject(w, vctx)!);
      for (const x of exterior.filter((e) => e.levelId === w.levelId)) {
        const xb = bbox(buildElementObject(x, vctx)!);
        // Never reaching an exterior wall's outer face (which would show as a stripe on the façade).
        const horizontal = Math.abs(x.start.z - x.end.z) < 1e-6;
        if (!ib.intersectsBox(xb)) continue;
        if (horizontal) expect(ib.max.z <= xb.max.z - 0.05 && ib.min.z >= xb.min.z + 0.05 || ib.max.z <= xb.min.z + 1e-6 || ib.min.z >= xb.max.z - 1e-6).toBe(true);
      }
    }
  });

  it('cuts real openings into host walls', () => {
    const ctx = createBuildContext(scene, mat);
    const w = scene.elements.find((e) => e.type === 'window') as WindowElement;
    const host = scene.elements.find((e) => e.id === w.hostId) as WallElement;
    const withHole = buildElementObject(host, ctx)!;
    const noOpen = { ...scene, elements: scene.elements.filter((e) => !('hostId' in e && e.hostId === host.id)) };
    const plain = buildElementObject(host, createBuildContext(noOpen, mat))!;
    const count = (o: THREE.Object3D) => {
      let n = 0;
      o.traverse((c) => {
        if ((c as THREE.Mesh).isMesh) n += ((c as THREE.Mesh).geometry as THREE.BufferGeometry).attributes.position.count;
      });
      return n;
    };
    expect(count(withHole)).toBeGreaterThan(count(plain));
  });

  it('updates window geometry after an edit', () => {
    const w = scene.elements.find((e) => e.type === 'window') as WindowElement;
    const before = bbox(buildElementObject(w, createBuildContext(scene, mat))!);
    const r = applyOperations(scene, [{ op: 'modify', id: w.id, set: { width: 1.8 } }]);
    const after = bbox(buildElementObject(r.scene.elements.find((e) => e.id === w.id)!, createBuildContext(r.scene, mat))!);
    const span = (b: THREE.Box3) => Math.max(b.max.x - b.min.x, b.max.z - b.min.z);
    expect(span(before)).toBeCloseTo(1.2, 2);
    expect(span(after)).toBeCloseTo(1.8, 2);
  });

  it('tags every mesh with its element id', () => {
    const g = buildSceneGroup(scene, mat);
    let untagged = 0;
    g.traverse((c) => {
      if ((c as THREE.Mesh).isMesh && !c.userData.elementId) untagged++;
    });
    expect(untagged).toBe(0);
  });

  it('builds every element type of a furnished villa without NaNs', () => {
    const villa = generateBuilding({ kind: 'villa', blocks: [{ width: 16, depth: 10, floors: 2 }], roof: { type: 'hip' }, furnish: true, extras: { pool: {}, terrace: {} } }).scene;
    const withSky = applyOperations(villa, [
      { op: 'create', element: { type: 'skylight', hostId: villa.elements.find((e) => e.type === 'roof')!.id, u: 1, v: 1 } },
      { op: 'create', element: { type: 'column', position: { x: 0, z: 8 } } },
      { op: 'create', element: { type: 'beam', start: { x: -2, y: 2.9, z: 8 }, end: { x: 2, y: 2.9, z: 8 } } },
    ]).scene;
    const g = buildSceneGroup(withSky, mat);
    let bad = 0;
    g.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh) return;
      const arr = (m.geometry as THREE.BufferGeometry).attributes.position.array as Float32Array;
      for (const v of arr) if (!Number.isFinite(v)) bad++;
    });
    expect(bad).toBe(0);
    expect(g.children.length).toBeGreaterThan(80);
    for (const type of ['gable', 'shed', 'flat', 'hip'] as const) {
      const roof = villa.elements.find((e) => e.type === 'roof')!;
      const s2 = applyOperations(villa, [{ op: 'modify', id: roof.id, set: { roofType: type } }]).scene;
      const b = bbox(buildElementObject(s2.elements.find((e) => e.id === roof.id)!, createBuildContext(s2, mat))!);
      expect(b.isEmpty()).toBe(false);
    }
  });
});
