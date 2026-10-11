import { Element, ELEMENT_TYPE_LABELS, type ElementType } from '../schema/elements';
import { allocateId, type Scene } from '../schema/scene';
import { findElement } from './query';

type Partial2 = Record<string, unknown> & { type: ElementType };

/** Per-type defaults applied when an element is created by the user or the AI. */
export function defaultsFor(type: ElementType, scene: Scene, input: Partial2): Record<string, unknown> {
  const lvl = scene.levels[0];
  switch (type) {
    case 'wall':
      return { height: lvl.height, thickness: 0.2, baseOffset: 0, material: 'plaster_white', exterior: false, start: { x: 0, z: 0 }, end: { x: 4, z: 0 } };
    case 'window': {
      const host = typeof input.hostId === 'string' ? findElement(scene, input.hostId) : undefined;
      const wallH = host && host.type === 'wall' ? host.height : lvl.height;
      return {
        width: 1.2,
        height: Math.min(1.4, wallH - 1.0),
        sillHeight: 0.9,
        frameMaterial: 'aluminium_black',
        glazingMaterial: 'glass_clear',
        style: 'casement',
        frameDepth: 0.08,
        frameWidth: 0.06,
        mullionsVertical: 0,
        mullionsHorizontal: 0,
        offset: host && host.type === 'wall' ? Math.hypot(host.end.x - host.start.x, host.end.z - host.start.z) / 2 : 1,
      };
    }
    case 'door': {
      const host = typeof input.hostId === 'string' ? findElement(scene, input.hostId) : undefined;
      return {
        width: 0.9,
        height: 2.1,
        doorType: 'hinged',
        swing: 'left',
        frameMaterial: 'aluminium_black',
        leafMaterial: 'oak',
        frameDepth: 0.1,
        offset: host && host.type === 'wall' ? Math.hypot(host.end.x - host.start.x, host.end.z - host.start.z) / 2 : 1,
      };
    }
    case 'slab':
      return { thickness: 0.2, elevation: 0, material: 'concrete', role: 'floor' };
    case 'roof':
      return {
        roofType: 'gable',
        center: { x: 0, z: 0 },
        width: 8,
        depth: 6,
        rotation: 0,
        pitchDeg: 30,
        overhang: 0.4,
        thickness: 0.25,
        baseOffset: lvl.height,
        ridgeAxis: 'x',
        material: 'metal_dark_grey',
        parapetHeight: 0,
      };
    case 'skylight':
      return { u: 0, v: 0, width: 0.8, length: 1.2, frameMaterial: 'aluminium_black', glazingMaterial: 'glass_clear' };
    case 'stair':
      return { position: { x: 0, z: 0 }, rotation: 0, width: 1.0, totalRise: lvl.height, totalRun: 4.0, steps: 15, baseOffset: 0, material: 'oak' };
    case 'column':
      return { position: { x: 0, z: 0 }, width: 0.3, depth: 0.3, height: lvl.height, baseOffset: 0, shape: 'rect', rotation: 0, material: 'concrete' };
    case 'beam':
      return { start: { x: 0, y: lvl.height, z: 0 }, end: { x: 4, y: lvl.height, z: 0 }, width: 0.2, depth: 0.4, material: 'oak' };
    case 'room':
      return { function: 'other' };
    case 'furniture':
      return { position: { x: 0, y: 0, z: 0 }, rotation: 0, width: 1, depth: 1, height: 0.8, material: 'oak', kind: 'box' };
    case 'terrain':
      return { center: { x: 0, z: 0 }, width: 60, depth: 60, elevation: -0.02, material: 'grass' };
    case 'pool':
      return { center: { x: 0, z: 6 }, width: 4, length: 10, waterDepth: 1.5, rotation: 0, copingWidth: 0.3, material: 'tile_pool', copingMaterial: 'stone_light' };
    case 'box':
      return { position: { x: 0, y: 0, z: 0 }, rotation: 0, width: 1, depth: 1, height: 1, material: 'concrete' };
  }
}

/**
 * Builds a fully validated element from a partial description. Allocates a new
 * persistent id unless `keepId` is set and the given id is free.
 */
export function createElement(scene: Scene, input: Partial2, opts: { keepId?: boolean; levelId?: string } = {}): Element {
  const type = input.type;
  let id = typeof input.id === 'string' && opts.keepId ? input.id : undefined;
  if (id && scene.elements.some((e) => e.id === id)) id = undefined;
  if (!id) id = allocateId(scene, type);
  const defaults = defaultsFor(type, scene, input);
  const n = scene.counters[type] ?? 1;
  const hostLevel =
    typeof input.hostId === 'string' ? (findElement(scene, input.hostId)?.levelId ?? undefined) : undefined;
  const merged: Record<string, unknown> = {
    ...defaults,
    ...stripUndefined(input),
    id,
    type,
    name: (typeof input.name === 'string' && input.name) || `${ELEMENT_TYPE_LABELS[type]} ${n}`,
    levelId: (input.levelId as string | undefined) ?? hostLevel ?? opts.levelId ?? scene.levels[0].id,
  };
  return Element.parse(merged);
}

function stripUndefined(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null) out[k] = v;
  return out;
}
