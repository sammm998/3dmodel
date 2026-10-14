import { describe, expect, it } from 'vitest';
import { generateBuilding } from '@/core/generator/generateBuilding';
import { STARTERS } from '@/core/generator/starters';
import { interpret } from '@/core/ai/interpreter';
import { applyOperations } from '@/core/ops/apply';
import { emptyScene } from '@/core/schema/scene';
import { findBlockedPassages, findClashes, furnitureOBB, obbOverlap, resolveFurnitureClashes } from '@/core/scene/clashes';
import { furnishRoom } from '@/core/generator/furnish';
import { pointInPolygon } from '@/core/geometry/math2d';
import { pointAlongWall, findElement, wallFrame } from '@/core/scene/query';
import type { DoorElement, FurnitureElement, RoomElement, WallElement, WindowElement } from '@/core/schema/elements';

describe('clash detection', () => {
  it('detects overlapping and separated oriented boxes', () => {
    const a = furnitureOBB({ position: { x: 0, y: 0, z: 0 }, rotation: 0, width: 2, depth: 1 });
    expect(obbOverlap(a, furnitureOBB({ position: { x: 1.5, y: 0, z: 0 }, rotation: 0, width: 2, depth: 1 }))).toBeGreaterThan(0);
    expect(obbOverlap(a, furnitureOBB({ position: { x: 2.2, y: 0, z: 0 }, rotation: 0, width: 2, depth: 1 }))).toBeLessThanOrEqual(0);
    // Rotated 45° box near a corner: separated along a diagonal axis.
    expect(obbOverlap(a, furnitureOBB({ position: { x: 1.75, y: 0, z: 1.25 }, rotation: Math.PI / 4, width: 1, depth: 1 }))).toBeLessThanOrEqual(0);
  });

  it.each(STARTERS.map((s) => s.id))('%s: generated furniture never blocks doors, stairs or glazing and never overlaps', (id) => {
    const raw = generateBuilding(STARTERS.find((s) => s.id === id)!.program, { resolveClashes: false }).scene;
    const fixed = generateBuilding(STARTERS.find((s) => s.id === id)!.program).scene;
    expect(findClashes(fixed)).toEqual([]);
    // The planning pass keeps the rooms furnished (nothing silently dropped here).
    const count = (sc: typeof raw) => sc.elements.filter((e) => e.type === 'furniture').length;
    expect(count(fixed)).toBe(count(raw));
  });

  it.each([
    'a three bedroom house with two floors, open plan kitchen and living room, two bathrooms',
    'Create a modern office for 40 people with meeting rooms',
    'small cabin 6 by 8 meters with a sauna',
    '5 floor apartment complex',
  ])('prompt "%s" is planned without clashes', (prompt) => {
    const r = interpret(prompt, { scene: emptyScene(), selectedIds: [] });
    const applied = applyOperations(emptyScene(), r.operations);
    expect(applied.ok).toBe(true);
    expect(findClashes(applied.scene)).toEqual([]);
  });

  it('warns when an edit moves furniture into a doorway', () => {
    const scene = generateBuilding(STARTERS.find((s) => s.id === 'scandinavian-villa')!.program).scene;
    const door = scene.elements.find((e): e is DoorElement => e.type === 'door' && e.name.startsWith('Door to'))!;
    const host = findElement(scene, door.hostId)!;
    const p = pointAlongWall(host as never, door.offset);
    const chair = scene.elements.find((e): e is FurnitureElement => e.type === 'furniture' && e.kind === 'armchair') ?? scene.elements.find((e): e is FurnitureElement => e.type === 'furniture' && e.kind === 'chair')!;
    const r = applyOperations(scene, [{ op: 'modify', id: chair.id, set: { position: { x: p.x, y: 0, z: p.z } } }]);
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => /blocks|intersects/.test(w))).toBe(true);
    // And the resolver can put it somewhere free again.
    expect(findClashes(resolveFurnitureClashes(r.scene).scene)).toEqual([]);
  });
});

describe('assistant: fix clashes', () => {
  it('"fix clashes" / "ordna möblerna" re-places blocking furniture through validated operations', () => {
    // The generator now plans clash-free, so push two pieces into doorways by hand.
    const base = generateBuilding(STARTERS.find((s) => s.id === 'scandinavian-villa')!.program).scene;
    const doors = base.elements.filter((e): e is DoorElement => e.type === 'door' && e.name.startsWith('Door to'));
    const pieces = base.elements.filter((e): e is FurnitureElement => e.type === 'furniture' && (e.kind === 'armchair' || e.kind === 'plant' || e.kind === 'nightstand'));
    const ops = pieces.slice(0, 2).map((f, i) => {
      const p = pointAlongWall(findElement(base, doors[i].hostId) as never, doors[i].offset);
      return { op: 'modify' as const, id: f.id, set: { position: { x: p.x, y: 0, z: p.z }, levelId: doors[i].levelId } };
    });
    const scene = applyOperations(base, ops).scene;
    expect(findClashes(scene).length).toBeGreaterThan(0);
    for (const text of ['fix the furniture clashes', 'ordna möblerna så inget krockar']) {
      const r = interpret(text, { scene, selectedIds: [] });
      expect(r.understood).toBe(true);
      expect(r.operations.length).toBeGreaterThan(0);
      const applied = applyOperations(scene, r.operations);
      expect(applied.ok).toBe(true);
      expect(findClashes(applied.scene)).toEqual([]);
    }
  });
});

describe('planning', () => {
  const plans: [string, Parameters<typeof generateBuilding>[0]][] = [
    ...STARTERS.map((s) => [s.id, s.program] as [string, Parameters<typeof generateBuilding>[0]]),
    ['3-bed flat', { kind: 'apartment', blocks: [{ width: 11, depth: 8 }], program: { bedrooms: 3, bathrooms: 1 }, furnish: true }],
    ['compact house', { kind: 'house', blocks: [{ width: 9, depth: 7, floors: 1 }], program: { bedrooms: 2, bathrooms: 1 }, furnish: true }],
    ['family house', { kind: 'house', blocks: [{ width: 12, depth: 9, floors: 2 }], program: { bedrooms: 4, bathrooms: 2 }, furnish: true }],
  ];

  it.each(plans)('%s: rooms get usable sizes and the key fixtures', (_id, program) => {
    const scene = generateBuilding(program).scene;
    const rooms = scene.elements.filter((e): e is RoomElement => e.type === 'room');
    const furniture = scene.elements.filter((e): e is FurnitureElement => e.type === 'furniture');
    const short = (r: RoomElement) => {
      const xs = r.polygon.map((p) => p.x);
      const zs = r.polygon.map((p) => p.z);
      return Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
    };
    const inside = (r: RoomElement) => furniture.filter((f) => f.levelId === r.levelId && pointInPolygon({ x: f.position.x, z: f.position.z }, r.polygon)).map((f) => f.kind);
    for (const r of rooms) {
      if (/bedroom/i.test(r.name)) {
        expect(short(r), r.name).toBeGreaterThanOrEqual(2.6);
        expect(inside(r), r.name).toContain('bed');
      }
      if (/^bathroom/i.test(r.name)) {
        expect(short(r), r.name).toBeGreaterThanOrEqual(1.6);
        expect(inside(r), r.name).toContain('toilet');
      }
      if (/kitchen/i.test(r.name)) expect(inside(r), r.name).toContain('kitchen_counter');
      if (/living/i.test(r.name)) expect(inside(r), r.name).toContain('sofa');
    }
    expect(findClashes(scene)).toEqual([]);
  });

  it.each(plans)('%s: no window straddles a partition', (_id, program) => {
    const scene = generateBuilding(program).scene;
    const walls = scene.elements.filter((e): e is WallElement => e.type === 'wall');
    for (const win of scene.elements.filter((e): e is WindowElement => e.type === 'window')) {
      const host = walls.find((w) => w.id === win.hostId)!;
      const f = wallFrame(host);
      for (const iw of walls.filter((w) => !w.exterior && w.levelId === host.levelId)) {
        for (const q of [iw.start, iw.end]) {
          const t = (q.x - host.start.x) * f.dir.x + (q.z - host.start.z) * f.dir.z;
          const perp = Math.abs((q.x - host.start.x) * f.dir.z - (q.z - host.start.z) * f.dir.x);
          if (perp > host.thickness / 2 + 0.05) continue;
          expect(Math.abs(t - win.offset), `${win.name} vs ${iw.name}`).toBeGreaterThanOrEqual(win.width / 2 + iw.thickness / 2);
        }
      }
    }
  });

  it('bedrooms and bathrooms open off circulation, not through each other', () => {
    for (const [, program] of plans.slice(-3)) {
      const scene = generateBuilding(program).scene;
      const rooms = scene.elements.filter((e): e is RoomElement => e.type === 'room');
      const doors = scene.elements.filter((e): e is DoorElement => e.type === 'door');
      const walls = scene.elements.filter((e): e is WallElement => e.type === 'wall');
      for (const r of rooms.filter((x) => /bedroom|bathroom/i.test(x.name))) {
        // Count doors into this room; a walk-through private room would have more than one
        // door into another private room.
        const into = doors.filter((d) => {
          const host = walls.find((w) => w.id === d.hostId)!;
          const p = pointAlongWall(host, d.offset);
          const n = wallFrame(host).normal;
          const sides = [1, -1].map((s) => ({ x: p.x + n.x * s * 0.4, z: p.z + n.z * s * 0.4 }));
          const there = sides.map((q) => rooms.find((o) => o.levelId === d.levelId && pointInPolygon(q, o.polygon)));
          return there.includes(r) && there.some((o) => o && o !== r && /bedroom|bathroom/i.test(o.name));
        });
        expect(into.length, r.name).toBe(0);
      }
    }
  });

  it('furnishes around doors and windows: the bed head avoids glazing, nothing stands in a door swing', () => {
    const room = { name: 'Bedroom 2', function: 'bedroom' as const, level: 0, x: 0, z: 0, width: 3.4, depth: 3.6 };
    // Window in the north wall, door in the west wall near the north corner.
    const items = furnishRoom(room, { openings: [{ kind: 'window', side: 'n', a: 1.1, b: 2.3 }, { kind: 'door', side: 'w', a: 0.4, b: 1.3 }] });
    const bed = items.find((i) => i.kind === 'bed')!;
    expect(bed).toBeTruthy();
    // Head against the east or south wall, i.e. not facing out from the glazed north wall.
    expect(Math.abs(bed.rotation)).toBeGreaterThan(0.1);
    for (const it of items.filter((i) => i.kind !== 'rug')) {
      const turned = Math.abs(Math.sin(it.rotation)) > 0.5;
      const hw = (turned ? it.depth : it.width) / 2;
      const hd = (turned ? it.width : it.depth) / 2;
      const inSwing = it.position.x - hw < 1.0 && it.position.z + hd > 0.4 && it.position.z - hd < 1.3;
      expect(inSwing, it.kind).toBe(false);
    }
  });

  it('reports and fixes furniture that closes off the way through a room', () => {
    const scene = generateBuilding(STARTERS.find((s) => s.id === 'scandinavian-villa')!.program).scene;
    const hall = scene.elements.find((e): e is RoomElement => e.type === 'room' && e.name === 'Entrance hall')!;
    const xs = hall.polygon.map((p) => p.x);
    const zs = hall.polygon.map((p) => p.z);
    // A wardrobe right across the hall, mid-way along it.
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cz = (Math.min(...zs) + Math.max(...zs)) / 2 + 1.2;
    const r = applyOperations(scene, [{ op: 'create', element: { type: 'furniture', kind: 'wardrobe', name: 'Wardrobe', levelId: hall.levelId, position: { x: cx, y: 0, z: cz }, rotation: 0, width: Math.max(...xs) - Math.min(...xs) - 0.1, depth: 0.6, height: 2.2, material: 'oak' } }]);
    expect(r.ok).toBe(true);
    const blocked = findBlockedPassages(r.scene);
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked[0].message).toMatch(/blocks the way/);
    expect(findClashes(resolveFurnitureClashes(r.scene).scene).filter((c) => c.kind === 'passage')).toEqual([]);
  });
});
