import { describe, expect, it } from 'vitest';
import { generateBuilding } from '@/core/generator/generateBuilding';
import { Scene } from '@/core/schema/scene';
import { validateScene } from '@/core/ops/validate';
import { wallFrame } from '@/core/scene/query';
import type { WallElement } from '@/core/schema/elements';

describe('generateBuilding', () => {
  it('creates the acceptance-test room: 6 x 4 x 2.7 m with one door and two windows', () => {
    const { scene } = generateBuilding({ kind: 'room', blocks: [{ width: 6, depth: 4 }], floorHeight: 2.7, windows: { count: 2 }, doors: { count: 1 } });
    expect(() => Scene.parse(scene)).not.toThrow();
    const walls = scene.elements.filter((e): e is WallElement => e.type === 'wall');
    expect(walls).toHaveLength(4);
    const lengths = walls.map((w) => wallFrame(w).length).sort();
    expect(lengths).toEqual([4, 4, 6, 6]);
    expect(walls.every((w) => w.height === 2.7)).toBe(true);
    expect(scene.elements.filter((e) => e.type === 'door')).toHaveLength(1);
    expect(scene.elements.filter((e) => e.type === 'window')).toHaveLength(2);
    expect(scene.elements.filter((e) => e.type === 'slab')).toHaveLength(1);
    expect(scene.elements.some((e) => e.type === 'roof')).toBe(false);
    expect(validateScene(scene).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('gives every element a unique persistent id', () => {
    const { scene } = generateBuilding({ kind: 'villa', blocks: [{ width: 16, depth: 10, floors: 2 }], furnish: true, extras: { pool: {}, terrace: {} } });
    const ids = scene.elements.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^[a-z]+_\d{3,}$/.test(id))).toBe(true);
  });

  it('builds a valid multi-storey villa with rooms, stairs, roof, pool and furniture', () => {
    const { scene } = generateBuilding({
      kind: 'villa',
      blocks: [{ width: 16, depth: 10, floors: 2 }, { x: 16, z: 3, width: 6.5, depth: 7, floors: 1, garage: true }],
      windows: { style: 'floor_to_ceiling' },
      roof: { type: 'flat' },
      program: { bedrooms: 3, bathrooms: 2, living: true, kitchen: true, dining: true, offices: 0 },
      furnish: true,
      extras: { pool: {}, terrace: {} },
    });
    expect(scene.levels).toHaveLength(2);
    const count = (t: string) => scene.elements.filter((e) => e.type === t).length;
    expect(count('stair')).toBe(1);
    expect(count('roof')).toBe(2);
    expect(count('pool')).toBe(1);
    expect(count('furniture')).toBeGreaterThan(10);
    const rooms = scene.elements.filter((e) => e.type === 'room').map((r) => r.name);
    expect(rooms.filter((n) => /bedroom/i.test(n))).toHaveLength(3);
    expect(rooms.filter((n) => /bathroom/i.test(n))).toHaveLength(2);
    expect(validateScene(scene).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('places a curtain-wall facade on an office building', () => {
    const { scene } = generateBuilding({ kind: 'office', blocks: [{ width: 30, depth: 16, floors: 6 }], floorHeight: 3.6, windows: { style: 'curtain' }, roof: { type: 'flat' }, furnish: false });
    expect(scene.levels).toHaveLength(6);
    const curtain = scene.elements.filter((e) => e.type === 'window' && e.style === 'curtain');
    expect(curtain.length).toBeGreaterThanOrEqual(24);
    expect(validateScene(scene).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('is deterministic', () => {
    const p = { kind: 'house' as const, blocks: [{ width: 12, depth: 9, floors: 2 }], furnish: true };
    expect(JSON.stringify(generateBuilding(p).scene)).toEqual(JSON.stringify(generateBuilding(p).scene));
  });
});
