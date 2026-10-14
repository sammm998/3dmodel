import { describe, expect, it } from 'vitest';
import { generateBuilding } from '@/core/generator/generateBuilding';
import { STARTERS } from '@/core/generator/starters';
import { interpret } from '@/core/ai/interpreter';
import { applyOperations } from '@/core/ops/apply';
import { emptyScene } from '@/core/schema/scene';
import { findClashes, furnitureOBB, obbOverlap, resolveFurnitureClashes } from '@/core/scene/clashes';
import { pointAlongWall, findElement } from '@/core/scene/query';
import type { DoorElement, FurnitureElement } from '@/core/schema/elements';

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
    const scene = generateBuilding(STARTERS.find((s) => s.id === 'scandinavian-villa')!.program, { resolveClashes: false }).scene;
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
