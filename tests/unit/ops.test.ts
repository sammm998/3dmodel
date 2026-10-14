import { describe, expect, it } from 'vitest';
import { applyOperations } from '@/core/ops/apply';
import { generateBuilding } from '@/core/generator/generateBuilding';
import { findElement, wallFrame } from '@/core/scene/query';
import type { Scene } from '@/core/schema/scene';
import type { WallElement, WindowElement } from '@/core/schema/elements';

const room = (): Scene =>
  generateBuilding({ kind: 'room', blocks: [{ width: 6, depth: 4 }], floorHeight: 2.7, windows: { count: 2 }, doors: { count: 1 } }).scene;

const win = (s: Scene, id: string) => findElement(s, id) as WindowElement;
const wall = (s: Scene, id: string) => findElement(s, id) as WallElement;

describe('applyOperations', () => {
  it('modifies only the targeted window', () => {
    const s = room();
    const [w1, w2] = s.elements.filter((e) => e.type === 'window') as WindowElement[];
    const r = applyOperations(s, [
      { op: 'modify', id: w1.id, set: { width: 1.8 } },
      { op: 'set_material', ids: [w1.id], material: 'aluminium_black', slot: 'frameMaterial' },
    ], { scopeIds: [w1.id] });
    expect(r.ok).toBe(true);
    expect(win(r.scene, w1.id).width).toBe(1.8);
    expect(win(r.scene, w2.id)).toEqual(w2);
    expect(r.changes.map((c) => c.id)).toEqual([w1.id]);
    expect(r.requiresConfirmation).toBe(false);
    // input untouched (enables undo by snapshot)
    expect(win(s, w1.id).width).toBe(1.2);
  });

  it('rejects openings that no longer fit their wall and leaves the scene unchanged', () => {
    const s = room();
    const w = s.elements.find((e) => e.type === 'window') as WindowElement;
    const r = applyOperations(s, [{ op: 'modify', id: w.id, set: { width: 9 } }]);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/does not fit/);
    expect(r.scene).toBe(s);
  });

  it('scales relative dimensions (30% wider keeps centre)', () => {
    const s = room();
    const w = s.elements.find((e) => e.type === 'window') as WindowElement;
    const r = applyOperations(s, [{ op: 'modify', id: w.id, scale: { width: 1.3 } }]);
    expect(r.ok).toBe(true);
    expect(win(r.scene, w.id).width).toBeCloseTo(1.56);
    expect(win(r.scene, w.id).offset).toBe(w.offset);
  });

  it('moves a wall perpendicular and stretches joined walls while keeping openings in place', () => {
    const s = room();
    const north = s.elements.find((e) => e.type === 'wall' && e.name.startsWith('North')) as WallElement;
    const r = applyOperations(s, [{ op: 'modify', id: north.id, translate: { z: -1 } }], { scopeIds: [north.id] });
    expect(r.ok).toBe(true);
    const moved = wall(r.scene, north.id);
    expect(moved.start.z).toBeCloseTo(north.start.z - 1);
    const west = r.scene.elements.find((e) => e.type === 'wall' && e.name.startsWith('West')) as WallElement;
    expect(wallFrame(west).length).toBeCloseTo(5);
    // joined walls changed as dependents, not flagged as out of scope
    const dep = r.changes.filter((c) => c.dependent);
    // Two joined walls, plus the room outline and floor slab that follow the wall.
    expect(dep.length).toBe(4);
    expect(dep.map((c) => findElement(r.scene, c.id)?.type).sort()).toEqual(['room', 'slab', 'wall', 'wall']);
    expect(r.changes.some((c) => c.outOfScope)).toBe(false);
    // the window hosted on the moved wall keeps its offset
    const hosted = r.scene.elements.filter((e) => e.type === 'window' && e.hostId === north.id) as WindowElement[];
    for (const h of hosted) expect(h.offset).toBe((findElement(s, h.id) as WindowElement).offset);
  });

  it('cascades deletion to hosted openings and requires confirmation', () => {
    const s = room();
    const south = s.elements.find((e) => e.type === 'wall' && e.name.startsWith('South')) as WallElement;
    const r = applyOperations(s, [{ op: 'delete', id: south.id }]);
    expect(r.ok).toBe(true);
    expect(r.scene.elements.some((e) => 'hostId' in e && e.hostId === south.id)).toBe(false);
    expect(r.destructive).toBe(true);
    expect(r.requiresConfirmation).toBe(true);
  });

  it('flags explicit edits outside the selection scope', () => {
    const s = room();
    const [w1, w2] = s.elements.filter((e) => e.type === 'window');
    const r = applyOperations(s, [{ op: 'modify', id: w2.id, set: { height: 1.0 } }], { scopeIds: [w1.id] });
    expect(r.changes[0].outOfScope).toBe(true);
    expect(r.requiresConfirmation).toBe(true);
  });

  it('rejects unknown materials, unknown ids and schema violations', () => {
    const s = room();
    const w = s.elements.find((e) => e.type === 'window')!;
    expect(applyOperations(s, [{ op: 'set_material', ids: [w.id], material: 'unobtainium' }]).ok).toBe(false);
    expect(applyOperations(s, [{ op: 'modify', id: 'wall_999', set: { height: 3 } }]).ok).toBe(false);
    expect(applyOperations(s, [{ op: 'modify', id: w.id, set: { height: -2 } }]).ok).toBe(false);
    expect(applyOperations(s, [{ op: 'modify', id: w.id, set: { id: 'x' } }]).ok).toBe(false);
    expect(applyOperations(s, [{ op: 'explode' } as never]).ok).toBe(false);
  });

  it('creates elements with refs and hosts openings on them', () => {
    const s = room();
    const r = applyOperations(s, [
      { op: 'create', ref: '$w', element: { type: 'wall', start: { x: 4, z: -2 }, end: { x: 9, z: -2 } } },
      { op: 'create', element: { type: 'window', hostId: '$w', offset: 2.5 } },
    ]);
    expect(r.ok).toBe(true);
    const newWall = r.refs.$w;
    expect(r.scene.elements.some((e) => e.type === 'window' && e.hostId === newWall)).toBe(true);
  });

  it('changes level height and dependent walls', () => {
    const s = room();
    const r = applyOperations(s, [{ op: 'set_level', id: 'level_0', height: 3.0, preserveOpeningProportions: true }]);
    expect(r.ok).toBe(true);
    expect(r.scene.elements.filter((e) => e.type === 'wall').every((w) => (w as WallElement).height === 3)).toBe(true);
  });

  it('replaces a window with a door on the same host', () => {
    const s = room();
    const w = s.elements.find((e) => e.type === 'window') as WindowElement;
    const r = applyOperations(s, [{ op: 'replace', id: w.id, element: { type: 'door', width: 0.9 } }]);
    expect(r.ok).toBe(true);
    const door = r.scene.elements.find((e) => e.type === 'door' && e.hostId === w.hostId && Math.abs(e.offset - w.offset) < 1e-9);
    expect(door).toBeTruthy();
    expect(findElement(r.scene, w.id)).toBeUndefined();
  });

  it('never reuses ids after deletion', () => {
    const s = room();
    const w = s.elements.find((e) => e.type === 'window')!;
    const r1 = applyOperations(s, [{ op: 'delete', id: w.id }]);
    const host = (w as WindowElement).hostId;
    const r2 = applyOperations(r1.scene, [{ op: 'create', element: { type: 'window', hostId: host } }]);
    expect(r2.scene.elements.some((e) => e.id === w.id)).toBe(false);
  });
});
