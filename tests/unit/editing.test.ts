import { describe, expect, it } from 'vitest';
import { generateBuilding } from '@/core/generator/generateBuilding';
import { STARTERS } from '@/core/generator/starters';
import { applyOperations } from '@/core/ops/apply';
import { findClashes } from '@/core/scene/clashes';
import { duplicateRoomOps, moveRoomOps, ROOM_TEMPLATES, roomParts, roomTemplateOps } from '@/core/scene/rooms';
import { polygonArea } from '@/core/geometry/math2d';
import { emptyScene, type Scene } from '@/core/schema/scene';
import { interpret } from '@/core/ai/interpreter';
import type { FurnitureElement, RoomElement, SlabElement, WallElement } from '@/core/schema/elements';

const villa = () => generateBuilding(STARTERS.find((s) => s.id === 'scandinavian-villa')!.program).scene;
const roomNamed = (s: Scene, name: string) => s.elements.find((e): e is RoomElement => e.type === 'room' && e.name === name)!;
const wallNamed = (s: Scene, name: string) => s.elements.find((e): e is WallElement => e.type === 'wall' && e.name === name)!;
const area = (r: RoomElement) => Math.abs(polygonArea(r.polygon));

describe('dragging walls', () => {
  it('moving a partition sideways resizes the rooms on both sides and keeps T-junctions joined', () => {
    const scene = villa();
    const wall = wallNamed(scene, 'Living Room / Dining wall') ?? scene.elements.find((e): e is WallElement => e.type === 'wall' && !e.exterior && Math.abs(e.start.x - e.end.x) < 1e-6)!;
    expect(wall).toBeTruthy();
    const rooms = scene.elements.filter((e): e is RoomElement => e.type === 'room' && e.levelId === wall.levelId);
    const before = new Map(rooms.map((r) => [r.id, area(r)]));
    const r = applyOperations(scene, [{ op: 'modify', id: wall.id, translate: { x: 0.5 } }]);
    expect(r.ok, r.errors.join()).toBe(true);
    const after = r.scene.elements.filter((e): e is RoomElement => e.type === 'room' && e.levelId === wall.levelId);
    const grew = after.filter((x) => area(x) > before.get(x.id)! + 0.1);
    const shrank = after.filter((x) => area(x) < before.get(x.id)! - 0.1);
    expect(grew.length).toBeGreaterThan(0);
    expect(shrank.length).toBeGreaterThan(0);
    // Total floor area is unchanged: the outline moved with the wall.
    const sum = (xs: RoomElement[]) => xs.reduce((a, x) => a + area(x), 0);
    expect(sum(after)).toBeCloseTo(sum(rooms), 3);
    // Every wall end that touched the moved wall's line still does.
    const moved = r.scene.elements.find((e) => e.id === wall.id) as WallElement;
    for (const w of r.scene.elements.filter((e): e is WallElement => e.type === 'wall' && e.levelId === wall.levelId && e.id !== wall.id)) {
      const old = scene.elements.find((e) => e.id === w.id) as WallElement;
      for (const end of ['start', 'end'] as const) {
        const touchedBefore = Math.abs(old[end].x - wall.start.x) < 0.02 && old[end].z > Math.min(wall.start.z, wall.end.z) - 0.02 && old[end].z < Math.max(wall.start.z, wall.end.z) + 0.02;
        if (touchedBefore) expect(w[end].x).toBeCloseTo(moved.start.x, 3);
      }
    }
  });

  it('pushing a façade wall out enlarges the rooms and floor behind it', () => {
    const scene = villa();
    const north = scene.elements.find((e): e is WallElement => e.type === 'wall' && e.exterior === true && /North/.test(e.name) && e.levelId === scene.levels[0].id)!;
    const z = north.start.z;
    const slabsBefore = scene.elements.filter((e): e is SlabElement => e.type === 'slab' && e.levelId === north.levelId).map((s) => Math.abs(polygonArea(s.polygon)));
    const r = applyOperations(scene, [{ op: 'modify', id: north.id, translate: { z: -1 } }]);
    expect(r.ok, r.errors.join()).toBe(true);
    const rooms = r.scene.elements.filter((e): e is RoomElement => e.type === 'room' && e.levelId === north.levelId);
    expect(rooms.some((x) => x.polygon.some((p) => Math.abs(p.z - (z - 1)) < 1e-6))).toBe(true);
    const slabsAfter = r.scene.elements.filter((e): e is SlabElement => e.type === 'slab' && e.levelId === north.levelId).map((s) => Math.abs(polygonArea(s.polygon)));
    expect(slabsAfter.reduce((a, b) => a + b, 0)).toBeGreaterThan(slabsBefore.reduce((a, b) => a + b, 0) + 1);
    // Partitions that ran up to the façade still reach it.
    const partitions = r.scene.elements.filter((e): e is WallElement => e.type === 'wall' && !e.exterior && e.levelId === north.levelId);
    const reaching = partitions.filter((w) => [w.start.z, w.end.z].some((v) => Math.abs(v - z) < 0.02));
    expect(reaching).toEqual([]);
  });
});

describe('rooms as a unit', () => {
  it('copies a furnished room beside the building with its walls, doors, windows and floor', () => {
    const scene = villa();
    const bed = roomNamed(scene, 'Master bedroom');
    const parts = roomParts(scene, bed);
    expect(parts.spans.length).toBeGreaterThanOrEqual(4);
    expect(parts.furniture.length).toBeGreaterThan(2);
    expect(parts.freeStanding).toBe(false);
    const r = applyOperations(scene, duplicateRoomOps(scene, bed.id));
    expect(r.ok, r.errors.join()).toBe(true);
    const copy = r.scene.elements.find((e): e is RoomElement => e.type === 'room' && e.name === 'Master bedroom copy')!;
    expect(copy).toBeTruthy();
    expect(area(copy)).toBeCloseTo(area(bed), 3);
    const copyParts = roomParts(r.scene, copy);
    expect(copyParts.freeStanding).toBe(true);
    expect(copyParts.furniture.map((f) => f.kind).sort()).toEqual(parts.furniture.map((f) => f.kind).sort());
    expect(copyParts.walls.length).toBe(parts.spans.length);
    expect(copyParts.openings.length).toBeGreaterThan(0);
    expect(findClashes(r.scene).filter((c) => copyParts.furniture.some((f) => f.id === c.elementId))).toEqual([]);
  });

  it('moves a free-standing room with everything in it; inside a building only the furniture moves', () => {
    const scene = villa();
    const r1 = applyOperations(scene, roomTemplateOps(scene, 'bedroom'));
    expect(r1.ok, r1.errors.join()).toBe(true);
    const room = r1.scene.elements.find((e): e is RoomElement => e.type === 'room' && e.name === 'Bedroom' && !scene.elements.some((o) => o.id === e.id))!;
    expect(room).toBeTruthy();
    const { ops, wholeRoom } = moveRoomOps(r1.scene, room.id, 0, 3);
    expect(wholeRoom).toBe(true);
    const r2 = applyOperations(r1.scene, ops);
    expect(r2.ok, r2.errors.join()).toBe(true);
    const moved = r2.scene.elements.find((e) => e.id === room.id) as RoomElement;
    expect(moved.polygon[0].z).toBeCloseTo(room.polygon[0].z + 3, 4);
    const before = roomParts(r1.scene, room);
    const after = roomParts(r2.scene, moved);
    expect(after.walls.length).toBe(before.walls.length);
    expect(after.furniture.length).toBe(before.furniture.length);
    expect(r2.warnings.filter((w) => /no longer joined/.test(w))).toEqual([]);

    const inside = roomNamed(scene, 'Living Room');
    const m = moveRoomOps(scene, inside.id, 0.2, 0);
    expect(m.wholeRoom).toBe(false);
    expect(m.ops.every((o) => o.op === 'modify' && (scene.elements.find((e) => e.id === o.id) as FurnitureElement).type === 'furniture')).toBe(true);
  });

  it.each(ROOM_TEMPLATES.map((t) => t.id))('template %s drops a furnished, clash-free room', (id) => {
    for (const base of [emptyScene(), villa()]) {
      const r = applyOperations(base, roomTemplateOps(base, id));
      expect(r.ok, r.errors.join()).toBe(true);
      const added = r.scene.elements.filter((e) => !base.elements.some((o) => o.id === e.id));
      const room = added.find((e): e is RoomElement => e.type === 'room')!;
      expect(room).toBeTruthy();
      const kinds = added.filter((e): e is FurnitureElement => e.type === 'furniture').map((f) => f.kind);
      const key = { bedroom: 'bed', 'master-bedroom': 'bed', bathroom: 'toilet', 'family-bathroom': 'bathtub', kitchen: 'kitchen_counter', 'living-room': 'sofa', 'dining-room': 'dining_table', 'home-office': 'desk' }[id]!;
      expect(kinds, id).toContain(key);
      expect(added.some((e) => e.type === 'door')).toBe(true);
      expect(findClashes(r.scene)).toEqual([]);
      // The rest of the scene is untouched.
      for (const e of base.elements) expect(r.scene.elements.find((x) => x.id === e.id)).toEqual(e);
    }
  });
});

describe('assistant: rooms', () => {
  it('copies a named room and adds template rooms, in English and Swedish', () => {
    const scene = villa();
    for (const text of ['copy the master bedroom', 'kopiera huvudsovrummet']) {
      const r = interpret(text, { scene, selectedIds: [] });
      expect(r.understood, text).toBe(true);
      const applied = applyOperations(scene, r.operations);
      expect(applied.ok, applied.errors.join()).toBe(true);
      expect(applied.scene.elements.some((e) => e.type === 'room' && e.name === 'Master bedroom copy')).toBe(true);
    }
    for (const [text, kind] of [
      ['add a bathroom', 'toilet'],
      ['lägg till ett sovrum', 'bed'],
      ['add a home office', 'desk'],
    ] as const) {
      const r = interpret(text, { scene, selectedIds: [] });
      expect(r.understood, text).toBe(true);
      const applied = applyOperations(scene, r.operations);
      expect(applied.ok, applied.errors.join()).toBe(true);
      const added = applied.scene.elements.filter((e): e is FurnitureElement => e.type === 'furniture' && !scene.elements.some((o) => o.id === e.id));
      expect(added.map((f) => f.kind), text).toContain(kind);
    }
    // Openings and single pieces are still ordinary edits.
    expect(interpret('add a sofa', { scene, selectedIds: [] }).operations[0]?.op).toBe('create');
  });
});
