import type {
  Element,
  ElementOf,
  ElementType,
  RoomElement,
  Vec2,
  Vec3,
  WallElement,
} from '../schema/elements';
import type { Level, Scene } from '../schema/scene';
import {
  dist2,
  len2,
  norm2,
  perp2,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
  projectOnSegment,
  round,
  sub2,
} from '../geometry/math2d';

export function findElement(scene: Scene, id: string): Element | undefined {
  return scene.elements.find((e) => e.id === id);
}

export function elementsOfType<T extends ElementType>(scene: Scene, type: T): ElementOf<T>[] {
  return scene.elements.filter((e): e is ElementOf<T> => e.type === type);
}

export function levelOf(scene: Scene, el: Element): Level {
  if (el.type === 'window' || el.type === 'door' || el.type === 'skylight') {
    const host = findElement(scene, el.hostId);
    if (host && host.id !== el.id) return levelOf(scene, host);
  }
  return scene.levels.find((l) => l.id === el.levelId) ?? scene.levels[0];
}

export interface WallFrame {
  start: Vec2;
  end: Vec2;
  dir: Vec2;
  /** Unit normal pointing to the wall's left side (from start looking at end). */
  normal: Vec2;
  length: number;
  /** Rotation around Y that maps local +x onto the wall direction. */
  angle: number;
}

export function wallFrame(w: Pick<WallElement, 'start' | 'end'>): WallFrame {
  const d = sub2(w.end, w.start);
  const dir = norm2(d);
  return { start: w.start, end: w.end, dir, normal: perp2(dir), length: len2(d), angle: -Math.atan2(d.z, d.x) };
}

/** Plan position of a point `offset` meters along a wall. */
export function pointAlongWall(w: Pick<WallElement, 'start' | 'end'>, offset: number): Vec2 {
  const f = wallFrame(w);
  return { x: w.start.x + f.dir.x * offset, z: w.start.z + f.dir.z * offset };
}

export function openingsOf(scene: Scene, wallId: string) {
  return scene.elements.filter(
    (e): e is ElementOf<'window'> | ElementOf<'door'> => (e.type === 'window' || e.type === 'door') && e.hostId === wallId,
  );
}

export function hostedChildren(scene: Scene, id: string): Element[] {
  return scene.elements.filter((e) => 'hostId' in e && e.hostId === id);
}

/**
 * Endpoint adjustments so that walls meeting at corners and T-junctions close
 * cleanly without any coplanar faces (which z-fight, i.e. flicker):
 * - L corner: the dominant wall (exterior, then taller, then thicker, then id)
 *   is extended by half the other's thickness and covers the corner; the
 *   other is trimmed back to the dominant wall's inner face (butt joint).
 * - T junction (an end on another wall's body): the abutting wall is trimmed
 *   to that wall's face.
 * Positive values extend, negative values trim (metres along the wall axis).
 */
export function computeWallExtensions(walls: WallElement[], tol = 0.02): Map<string, { start: number; end: number }> {
  const out = new Map<string, { start: number; end: number }>();
  const dominates = (w: WallElement, o: WallElement) => {
    if (!!w.exterior !== !!o.exterior) return !!w.exterior;
    if (Math.abs(w.height - o.height) > 1e-6) return w.height > o.height;
    if (Math.abs(w.thickness - o.thickness) > 1e-6) return w.thickness > o.thickness;
    return w.id < o.id;
  };
  for (const w of walls) {
    const ext = { start: 0, end: 0 };
    for (const key of ['start', 'end'] as const) {
      const p = w[key];
      let best: number | null = null;
      for (const o of walls) {
        if (o.id === w.id || o.levelId !== w.levelId) continue;
        const proj = projectOnSegment(p, o.start, o.end);
        if (proj.dist > tol) continue;
        // Collinear continuations need no adjustment.
        const a = norm2(sub2(w.end, w.start));
        const b = norm2(sub2(o.end, o.start));
        const cross = Math.abs(a.x * b.z - a.z * b.x);
        if (cross <= 0.2) continue;
        const atCorner = dist2(p, o.start) <= tol || dist2(p, o.end) <= tol;
        const v = atCorner && dominates(w, o) ? o.thickness / 2 : -o.thickness / 2;
        best = best === null ? v : Math.max(best, v);
      }
      ext[key] = best ?? 0;
    }
    out.set(w.id, ext);
  }
  return out;
}

/** Walls whose endpoints coincide with a given plan point (for dependency updates). */
export function wallsTouchingPoint(scene: Scene, p: Vec2, levelId: string | undefined, excludeId: string, tol = 0.02) {
  const result: { wall: WallElement; end: 'start' | 'end' }[] = [];
  for (const e of scene.elements) {
    if (e.type !== 'wall' || e.id === excludeId || e.levelId !== levelId) continue;
    if (dist2(e.start, p) <= tol) result.push({ wall: e, end: 'start' });
    else if (dist2(e.end, p) <= tol) result.push({ wall: e, end: 'end' });
  }
  return result;
}

/** World-space anchor point of an element (centre of its footprint at its base). */
export function elementAnchor(scene: Scene, el: Element): Vec3 {
  const lvl = levelOf(scene, el);
  const y0 = lvl.elevation;
  switch (el.type) {
    case 'wall': {
      return { x: (el.start.x + el.end.x) / 2, y: y0 + el.baseOffset, z: (el.start.z + el.end.z) / 2 };
    }
    case 'window':
    case 'door': {
      const host = findElement(scene, el.hostId);
      if (!host || host.type !== 'wall') return { x: 0, y: y0, z: 0 };
      const p = pointAlongWall(host, el.offset);
      const sill = el.type === 'window' ? el.sillHeight : 0;
      return { x: p.x, y: y0 + host.baseOffset + sill, z: p.z };
    }
    case 'slab':
    case 'room': {
      const c = polygonCentroid(el.polygon);
      return { x: c.x, y: y0 + (el.type === 'slab' ? el.elevation : 0), z: c.z };
    }
    case 'roof':
      return { x: el.center.x, y: y0 + el.baseOffset, z: el.center.z };
    case 'skylight': {
      const host = findElement(scene, el.hostId);
      if (!host || host.type !== 'roof') return { x: 0, y: y0, z: 0 };
      return { x: host.center.x + el.u, y: y0 + host.baseOffset, z: host.center.z + el.v };
    }
    case 'stair':
    case 'column':
      return { x: el.position.x, y: y0 + el.baseOffset, z: el.position.z };
    case 'beam':
      return { x: (el.start.x + el.end.x) / 2, y: y0 + (el.start.y + el.end.y) / 2, z: (el.start.z + el.end.z) / 2 };
    case 'furniture':
    case 'box':
      return { x: el.position.x, y: y0 + el.position.y, z: el.position.z };
    case 'terrain':
      return { x: el.center.x, y: y0 + el.elevation, z: el.center.z };
    case 'pool':
      return { x: el.center.x, y: y0, z: el.center.z };
  }
}

/** Key human-readable dimensions of an element, in meters. */
export function elementDimensions(scene: Scene, el: Element): Record<string, number> {
  const r = (v: number) => round(v, 3);
  switch (el.type) {
    case 'wall':
      return { length: r(wallFrame(el).length), height: r(el.height), thickness: r(el.thickness) };
    case 'window':
      return { width: r(el.width), height: r(el.height), sillHeight: r(el.sillHeight), offset: r(el.offset) };
    case 'door':
      return { width: r(el.width), height: r(el.height), offset: r(el.offset) };
    case 'slab':
      return { area: r(Math.abs(polygonArea(el.polygon))), thickness: r(el.thickness) };
    case 'room':
      return { area: r(Math.abs(polygonArea(el.polygon))) };
    case 'roof':
      return { width: r(el.width), depth: r(el.depth), pitchDeg: r(el.pitchDeg), overhang: r(el.overhang) };
    case 'skylight':
      return { width: r(el.width), length: r(el.length) };
    case 'stair':
      return { width: r(el.width), totalRise: r(el.totalRise), totalRun: r(el.totalRun), steps: el.steps };
    case 'column':
      return { width: r(el.width), depth: r(el.depth), height: r(el.height) };
    case 'beam':
      return {
        length: r(Math.hypot(el.end.x - el.start.x, el.end.y - el.start.y, el.end.z - el.start.z)),
        width: r(el.width),
        depth: r(el.depth),
      };
    case 'furniture':
    case 'box':
      return { width: r(el.width), depth: r(el.depth), height: r(el.height) };
    case 'terrain':
      return { width: r(el.width), depth: r(el.depth) };
    case 'pool':
      return { width: r(el.width), length: r(el.length), waterDepth: r(el.waterDepth) };
  }
}

/** Room whose polygon contains the element anchor on the same level. */
export function roomContaining(scene: Scene, el: Element): RoomElement | undefined {
  const a = elementAnchor(scene, el);
  const lvl = levelOf(scene, el);
  return elementsOfType(scene, 'room').find(
    (r) => (r.levelId ?? scene.levels[0].id) === lvl.id && pointInPolygon({ x: a.x, z: a.z }, r.polygon),
  );
}

export function elementsInRoom(scene: Scene, room: RoomElement, types?: ElementType[]): Element[] {
  const lvl = room.levelId ?? scene.levels[0].id;
  return scene.elements.filter((e) => {
    if (e.id === room.id) return false;
    if (types && !types.includes(e.type)) return false;
    if (levelOf(scene, e).id !== lvl) return false;
    const a = elementAnchor(scene, e);
    return pointInPolygon({ x: a.x, z: a.z }, room.polygon);
  });
}

/** Material slots exposed by an element type (field names). */
export function materialSlots(el: Element): string[] {
  switch (el.type) {
    case 'wall':
      return ['material', 'interiorMaterial'];
    case 'window':
    case 'skylight':
      return ['frameMaterial', 'glazingMaterial'];
    case 'door':
      return ['frameMaterial', 'leafMaterial'];
    case 'roof':
      return ['material', 'gableMaterial'];
    case 'room':
      return ['floorMaterial'];
    case 'furniture':
      return ['material', 'secondaryMaterial'];
    case 'pool':
      return ['material', 'copingMaterial'];
    default:
      return ['material'];
  }
}

/** Compact description used for AI context and the properties panel. */
export function describeElement(scene: Scene, el: Element) {
  const lvl = levelOf(scene, el);
  const anchor = elementAnchor(scene, el);
  const room = el.type === 'room' ? undefined : roomContaining(scene, el);
  const materials: Record<string, string> = {};
  for (const slot of materialSlots(el)) {
    const v = (el as Record<string, unknown>)[slot];
    if (typeof v === 'string') materials[slot] = v;
  }
  return {
    id: el.id,
    type: el.type,
    name: el.name,
    level: lvl.name,
    levelId: lvl.id,
    hostId: 'hostId' in el ? el.hostId : undefined,
    room: room ? { id: room.id, name: room.name } : undefined,
    anchor: { x: round(anchor.x, 3), y: round(anchor.y, 3), z: round(anchor.z, 3) },
    dimensions: elementDimensions(scene, el),
    materials,
  };
}

export function sceneBounds(scene: Scene): { min: Vec3; max: Vec3 } | null {
  let min: Vec3 | null = null;
  let max: Vec3 | null = null;
  const grow = (p: Vec3) => {
    min = min ? { x: Math.min(min.x, p.x), y: Math.min(min.y, p.y), z: Math.min(min.z, p.z) } : { ...p };
    max = max ? { x: Math.max(max.x, p.x), y: Math.max(max.y, p.y), z: Math.max(max.z, p.z) } : { ...p };
  };
  for (const el of scene.elements) {
    if (el.type === 'terrain') continue;
    const lvl = levelOf(scene, el);
    if (el.type === 'wall') {
      grow({ x: el.start.x, y: lvl.elevation, z: el.start.z });
      grow({ x: el.end.x, y: lvl.elevation + el.height + el.baseOffset, z: el.end.z });
    } else if (el.type === 'slab' || el.type === 'room') {
      for (const p of el.polygon) grow({ x: p.x, y: lvl.elevation, z: p.z });
    } else if (el.type === 'roof') {
      const hw = el.width / 2 + el.overhang;
      const hd = el.depth / 2 + el.overhang;
      grow({ x: el.center.x - hw, y: lvl.elevation + el.baseOffset, z: el.center.z - hd });
      grow({ x: el.center.x + hw, y: lvl.elevation + el.baseOffset + Math.tan((el.pitchDeg * Math.PI) / 180) * Math.min(hw, hd), z: el.center.z + hd });
    } else {
      grow(elementAnchor(scene, el));
    }
  }
  return min && max ? { min, max } : null;
}
