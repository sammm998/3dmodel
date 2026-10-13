import { describe, expect, it } from 'vitest';
import { interpret } from '@/core/ai/interpreter';
import { applyOperations } from '@/core/ops/apply';
import { emptyScene, type Scene } from '@/core/schema/scene';
import { findElement, wallFrame } from '@/core/scene/query';
import type { RoofElement, WallElement, WindowElement, DoorElement } from '@/core/schema/elements';

function run(scene: Scene, text: string, selectedIds: string[] = []) {
  const r = interpret(text, { scene, selectedIds });
  const applied = applyOperations(scene, r.operations, { scopeIds: selectedIds });
  return { r, applied };
}

describe('built-in interpreter + operation validation (acceptance flow)', () => {
  it('runs the required end-to-end edit sequence on the core engine', () => {
    // 3. prompt-to-scene
    const gen = run(emptyScene(), 'Create a rectangular room that is 6m long, 4m wide, and 2.7m high, with a door and two windows.');
    expect(gen.r.understood).toBe(true);
    expect(gen.applied.ok).toBe(true);
    const s1 = gen.applied.scene;
    const walls = s1.elements.filter((e): e is WallElement => e.type === 'wall');
    expect(walls).toHaveLength(4);
    expect(walls.map((w) => wallFrame(w).length).sort()).toEqual([4, 4, 6, 6]);
    expect(walls.every((w) => w.height === 2.7)).toBe(true);
    const windows = s1.elements.filter((e): e is WindowElement => e.type === 'window');
    expect(windows).toHaveLength(2);
    expect(s1.elements.filter((e) => e.type === 'door')).toHaveLength(1);
    expect(s1.elements.filter((e) => e.type === 'slab')).toHaveLength(1);

    // 6-8. select one window and edit it
    const [target, other] = windows;
    const edit = run(s1, 'Make this window 1.8m wide and change its frame to black.', [target.id]);
    expect(edit.applied.ok).toBe(true);
    expect(edit.applied.requiresConfirmation).toBe(false);
    const s2 = edit.applied.scene;
    const changed = findElement(s2, target.id) as WindowElement;
    expect(changed.width).toBe(1.8);
    expect(changed.frameMaterial).toBe('aluminium_black');
    // 9. other windows unchanged
    expect(findElement(s2, other.id)).toEqual(other);
    expect(edit.applied.changes.map((c) => c.id)).toEqual([target.id]);
  });

  it('understands Swedish', () => {
    const { applied } = run(emptyScene(), 'Skapa ett rum som är 5 m långt, 3 m brett och 2,5 m högt med en dörr och tre fönster');
    expect(applied.ok).toBe(true);
    expect(applied.scene.elements.filter((e) => e.type === 'window')).toHaveLength(3);
    expect(applied.scene.levels[0].height).toBe(2.5);
    const w = applied.scene.elements.find((e) => e.type === 'window')!;
    const e2 = run(applied.scene, 'gör fönstret 30% bredare', [w.id]);
    expect((findElement(e2.applied.scene, w.id) as WindowElement).width).toBeCloseTo((w as WindowElement).width * 1.3);
  });

  it('handles roof pitch, roof material and skylights in one utterance', () => {
    const { applied } = run(emptyScene(), 'Build a house 10m long and 8m wide with a gable roof');
    const roof = applied.scene.elements.find((e) => e.type === 'roof') as RoofElement;
    const r = run(applied.scene, 'Make the roof a little steeper, change it to dark gray metal, and add two skylights', [roof.id]);
    expect(r.applied.ok).toBe(true);
    const roof2 = findElement(r.applied.scene, roof.id) as RoofElement;
    expect(roof2.pitchDeg).toBe(roof.pitchDeg + 5);
    expect(roof2.material).toBe('metal_dark_grey');
    expect(r.applied.scene.elements.filter((e) => e.type === 'skylight')).toHaveLength(2);
  });

  it('moves a wall backwards by one meter and makes it taller', () => {
    const { applied } = run(emptyScene(), 'create a room 6m long 4m wide 2.7m high');
    const north = applied.scene.elements.find((e) => e.type === 'wall' && e.name.startsWith('North')) as WallElement;
    const r = run(applied.scene, 'Move this wall one meter backward and make it slightly taller', [north.id]);
    expect(r.applied.ok).toBe(true);
    const w = findElement(r.applied.scene, north.id) as WallElement;
    expect(Math.abs(w.start.z - north.start.z)).toBeCloseTo(1);
    expect(w.height).toBeCloseTo(2.97);
  });

  it('replaces a door with a sliding glass door', () => {
    const { applied } = run(emptyScene(), 'create a room 6m long 4m wide with a door');
    const door = applied.scene.elements.find((e) => e.type === 'door') as DoorElement;
    const r = run(applied.scene, 'Replace this door with a sliding glass door', [door.id]);
    expect(r.applied.ok).toBe(true);
    expect((findElement(r.applied.scene, door.id) as DoorElement).doorType).toBe('sliding_glass');
  });

  it('applies a material only to the selected objects', () => {
    const { applied } = run(emptyScene(), 'create a room 6m long 4m wide');
    const walls = applied.scene.elements.filter((e) => e.type === 'wall').slice(0, 3);
    const r = run(applied.scene, 'Change only these three objects to oak', walls.map((w) => w.id));
    expect(r.applied.ok).toBe(true);
    const oak = r.applied.scene.elements.filter((e) => e.type === 'wall' && e.material === 'oak');
    expect(oak.map((w) => w.id).sort()).toEqual(walls.map((w) => w.id).sort());
  });

  it('removes furniture in a room only after flagging confirmation', () => {
    const { applied } = run(emptyScene(), 'Build a minimalist living room with oak flooring, beige walls, a large sofa and warm lighting');
    const room = applied.scene.elements.find((e) => e.type === 'room')!;
    expect(applied.scene.elements.some((e) => e.type === 'furniture')).toBe(true);
    const r = run(applied.scene, 'Remove the furniture in this room', [room.id]);
    expect(r.r.needsConfirmation).toBe(true);
    expect(r.applied.requiresConfirmation).toBe(true);
    expect(r.applied.scene.elements.some((e) => e.type === 'furniture')).toBe(false);
  });

  it('asks a clarifying question instead of guessing when nothing is selected', () => {
    const { applied } = run(emptyScene(), 'create a room 6m long 4m wide with two windows');
    const r = interpret('make this bigger', { scene: applied.scene, selectedIds: [] });
    expect(r.operations).toHaveLength(0);
    expect(r.clarifyingQuestion).toBeTruthy();
  });

  it('raises ceiling height and preserves window proportions', () => {
    const { applied } = run(emptyScene(), 'create a room 6m long 4m wide 2.7m high with two windows');
    const w = applied.scene.elements.find((e) => e.type === 'window') as WindowElement;
    const r = run(applied.scene, 'Increase the ceiling height to 3 m but preserve the window proportions', [w.id]);
    expect(r.applied.ok).toBe(true);
    expect(r.applied.scene.levels[0].height).toBe(3);
    const w2 = findElement(r.applied.scene, w.id) as WindowElement;
    expect(w2.width / w2.height).toBeCloseTo(w.width / w.height, 3);
  });
});

describe('bare building descriptions', () => {
  it('builds "5 floor apartment complex" without a verb', () => {
    const { r, applied } = run(emptyScene(), '5 floor apartment complex');
    expect(r.understood).toBe(true);
    expect(applied.ok).toBe(true);
    expect(applied.scene.levels).toHaveLength(5);
    expect(applied.scene.elements.some((e) => e.type === 'roof')).toBe(true);
    expect(applied.scene.elements.filter((e) => e.type === 'stair')).toHaveLength(4);
  });
});

describe('relative lengths', () => {
  it('applies "40 cm wider" / "40 cm bredare" as an absolute delta, not a default percentage', () => {
    const base = run(emptyScene(), 'Create a rectangular room 6m long and 4m wide with one window').applied.scene;
    const win = base.elements.find((e): e is WindowElement => e.type === 'window')!;
    for (const text of ['Make this window 40 cm wider', 'gör fönstret 40 cm bredare', 'widen it by 0.4 m']) {
      const { applied } = run(base, text, [win.id]);
      expect(applied.ok, text).toBe(true);
      expect((findElement(applied.scene, win.id) as WindowElement).width, text).toBeCloseTo(win.width + 0.4, 4);
    }
  });
});
