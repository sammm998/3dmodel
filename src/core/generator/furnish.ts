/**
 * Furniture presets per room function. Positions are computed from the room
 * rectangle; furniture rotation 0 means the piece "faces" +z (south).
 */
import type { FurnitureKind } from '../schema/elements';
import type { ProgramRoom } from './program';
import { round } from '../geometry/math2d';

export interface FurnitureSpec {
  name: string;
  kind: FurnitureKind;
  position: { x: number; y: number; z: number };
  rotation: number;
  width: number;
  depth: number;
  height: number;
  material: string;
  secondaryMaterial?: string;
}

interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export const FURNITURE_DEFAULTS: Record<FurnitureKind, { w: number; d: number; h: number; m: string; m2?: string; label: string }> = {
  sofa: { w: 2.4, d: 0.95, h: 0.8, m: 'fabric_beige', m2: 'oak', label: 'Sofa' },
  armchair: { w: 0.85, d: 0.85, h: 0.8, m: 'leather_cognac', m2: 'oak', label: 'Armchair' },
  coffee_table: { w: 1.2, d: 0.6, h: 0.4, m: 'oak', m2: 'steel', label: 'Coffee table' },
  dining_table: { w: 1.8, d: 0.95, h: 0.75, m: 'oak', m2: 'aluminium_black', label: 'Dining table' },
  chair: { w: 0.48, d: 0.5, h: 0.82, m: 'oak', m2: 'fabric_grey', label: 'Chair' },
  bed: { w: 1.8, d: 2.1, h: 0.5, m: 'fabric_grey', m2: 'oak', label: 'Bed' },
  nightstand: { w: 0.5, d: 0.4, h: 0.5, m: 'oak', label: 'Nightstand' },
  wardrobe: { w: 1.8, d: 0.6, h: 2.2, m: 'oak', m2: 'brass', label: 'Wardrobe' },
  kitchen_counter: { w: 3.0, d: 0.62, h: 0.9, m: 'paint_white', m2: 'marble_white', label: 'Kitchen counter' },
  kitchen_island: { w: 2.2, d: 1.0, h: 0.9, m: 'walnut', m2: 'marble_white', label: 'Kitchen island' },
  desk: { w: 1.6, d: 0.8, h: 0.75, m: 'oak', m2: 'steel', label: 'Desk' },
  office_chair: { w: 0.6, d: 0.6, h: 1.0, m: 'fabric_grey', m2: 'steel', label: 'Office chair' },
  shelf: { w: 1.2, d: 0.35, h: 1.9, m: 'oak', label: 'Shelf' },
  rug: { w: 2.4, d: 1.7, h: 0.01, m: 'fabric_grey', label: 'Rug' },
  plant: { w: 0.5, d: 0.5, h: 1.3, m: 'foliage', m2: 'concrete', label: 'Plant' },
  floor_lamp: { w: 0.4, d: 0.4, h: 1.6, m: 'brass', m2: 'fabric_beige', label: 'Floor lamp' },
  pendant_lamp: { w: 0.4, d: 0.4, h: 0.4, m: 'brass', m2: 'fabric_beige', label: 'Pendant lamp' },
  tv_unit: { w: 1.8, d: 0.45, h: 0.5, m: 'walnut', m2: 'paint_black', label: 'TV unit' },
  bathtub: { w: 1.7, d: 0.75, h: 0.58, m: 'tile_white', label: 'Bathtub' },
  shower: { w: 0.9, d: 0.9, h: 2.0, m: 'tile_white', m2: 'glass_clear', label: 'Shower' },
  toilet: { w: 0.4, d: 0.65, h: 0.8, m: 'tile_white', label: 'Toilet' },
  vanity: { w: 1.0, d: 0.5, h: 0.85, m: 'oak', m2: 'marble_white', label: 'Vanity' },
  lounger: { w: 0.7, d: 1.9, h: 0.4, m: 'wood_deck', m2: 'fabric_beige', label: 'Lounger' },
  box: { w: 1, d: 1, h: 1, m: 'oak', label: 'Object' },
};

export function furnitureItem(
  kind: FurnitureKind,
  x: number,
  z: number,
  rotation = 0,
  overrides: Partial<Pick<FurnitureSpec, 'width' | 'depth' | 'height' | 'material' | 'secondaryMaterial' | 'name'>> & { y?: number } = {},
): FurnitureSpec {
  const d = FURNITURE_DEFAULTS[kind];
  return {
    name: overrides.name ?? d.label,
    kind,
    position: { x: round(x, 3), y: overrides.y ?? 0, z: round(z, 3) },
    rotation,
    width: overrides.width ?? d.w,
    depth: overrides.depth ?? d.d,
    height: overrides.height ?? d.h,
    material: overrides.material ?? d.m,
    secondaryMaterial: overrides.secondaryMaterial ?? d.m2,
  };
}

const PI = Math.PI;

/** A door or window in one of a room's four sides, as a world-space interval along that side. */
export interface RoomOpening {
  kind: 'door' | 'window';
  /** Side of the room rectangle: n = z0, s = z1, w = x0, e = x1. */
  side: 'n' | 's' | 'w' | 'e';
  /** Interval along the side (world x for n/s, world z for w/e). */
  a: number;
  b: number;
}

type Side = RoomOpening['side'];
type LocalSide = 'back' | 'front' | 'left' | 'right';

/**
 * Local frame for furnishing: the anchor wall (where the bed head, sofa back or
 * worktop goes) is the back wall at v = 0, u runs along it and v points into the
 * room. Rotation 0 in local space faces into the room.
 */
interface Frame {
  W: number;
  D: number;
  toWorld: (u: number, v: number) => { x: number; z: number };
  rot: number;
  sideOf: Record<Side, LocalSide>;
  /** World interval on a side → local interval along that local side. */
  along: (side: Side, a: number, b: number) => [number, number];
}

function frameFor(room: ProgramRoom, anchor: Side): Frame {
  const x0 = room.x;
  const z0 = room.z;
  const x1 = room.x + room.width;
  const z1 = room.z + room.depth;
  const sorted = (p: number, q: number): [number, number] => (p < q ? [p, q] : [q, p]);
  switch (anchor) {
    case 'n':
      return { W: room.width, D: room.depth, rot: 0, toWorld: (u, v) => ({ x: x0 + u, z: z0 + v }), sideOf: { n: 'back', s: 'front', w: 'left', e: 'right' }, along: (sd, a, b) => (sd === 'n' || sd === 's' ? sorted(a - x0, b - x0) : sorted(a - z0, b - z0)) };
    case 's':
      return { W: room.width, D: room.depth, rot: PI, toWorld: (u, v) => ({ x: x1 - u, z: z1 - v }), sideOf: { s: 'back', n: 'front', e: 'left', w: 'right' }, along: (sd, a, b) => (sd === 'n' || sd === 's' ? sorted(x1 - a, x1 - b) : sorted(z1 - a, z1 - b)) };
    case 'w':
      return { W: room.depth, D: room.width, rot: PI / 2, toWorld: (u, v) => ({ x: x0 + v, z: z1 - u }), sideOf: { w: 'back', e: 'front', s: 'left', n: 'right' }, along: (sd, a, b) => (sd === 'w' || sd === 'e' ? sorted(z1 - a, z1 - b) : sorted(a - x0, b - x0)) };
    case 'e':
      return { W: room.depth, D: room.width, rot: -PI / 2, toWorld: (u, v) => ({ x: x1 - v, z: z0 + u }), sideOf: { e: 'back', w: 'front', n: 'left', s: 'right' }, along: (sd, a, b) => (sd === 'w' || sd === 'e' ? sorted(a - z0, b - z0) : sorted(x1 - a, x1 - b)) };
  }
}

interface LocalOpening {
  kind: 'door' | 'window';
  side: LocalSide;
  a: number;
  b: number;
}

/** How far into a room a door's swing and passage zone reaches. */
const DOOR_REACH = 1.0;

type Span = { a: number; b: number; len: number; mid: number };

/** Largest gap between occupied intervals within [lo, hi]. */
function largestGap(occ: [number, number][], lo: number, hi: number): Span {
  occ.sort((p, q) => p[0] - q[0]);
  let best: Span = { a: lo, b: lo, len: 0, mid: lo };
  let cur = lo;
  for (const [a, b] of [...occ, [hi, hi] as [number, number]]) {
    const end = Math.min(a, hi);
    if (end - cur > best.len) best = { a: cur, b: end, len: end - cur, mid: (cur + end) / 2 };
    cur = Math.max(cur, b);
    if (cur >= hi) break;
  }
  return best;
}

/**
 * Free stretches along the sides of a W × D local room: a strip `depth` deep along a
 * side is blocked by openings in that side and by the passage zones of doors in the
 * neighbouring sides that reach into the strip.
 */
function spanFinder(openings: LocalOpening[], W: number, D: number) {
  const zones = openings
    .filter((o) => o.kind === 'door')
    .map((o) => {
      switch (o.side) {
        case 'back':
          return { side: o.side, u0: o.a, u1: o.b, v0: 0, v1: DOOR_REACH };
        case 'front':
          return { side: o.side, u0: o.a, u1: o.b, v0: D - DOOR_REACH, v1: D };
        case 'left':
          return { side: o.side, u0: 0, u1: DOOR_REACH, v0: o.a, v1: o.b };
        case 'right':
          return { side: o.side, u0: W - DOOR_REACH, u1: W, v0: o.a, v1: o.b };
      }
    });
  return (side: LocalSide, kinds: ('door' | 'window')[], lo: number, hi: number, depth = 0.7): Span => {
    const occ: [number, number][] = openings.filter((o) => o.side === side && kinds.includes(o.kind)).map((o) => [o.a - 0.15, o.b + 0.15]);
    for (const z of zones) {
      if (z.side === side) continue;
      if (side === 'back' && z.v0 < depth) occ.push([z.u0, z.u1]);
      if (side === 'front' && z.v1 > D - depth) occ.push([z.u0, z.u1]);
      if (side === 'left' && z.u0 < depth) occ.push([z.v0, z.v1]);
      if (side === 'right' && z.u1 > W - depth) occ.push([z.v0, z.v1]);
    }
    return largestGap(occ, lo, hi);
  };
}

export function furnishRoom(
  room: ProgramRoom,
  opts: { requested?: string[]; avoid?: Rect | null; openings?: RoomOpening[]; buildingKind?: string; anchor?: Side; wallHalf?: Partial<Record<Side, number>> } = {},
): FurnitureSpec[] {
  const openings = opts.openings ?? [];
  // Lay the room out from each wall in turn and keep the best result: the most (and
  // most important) pieces placed clear of door passages and glazing. The wall
  // heuristics (long solid stretches, the north wall) only break ties.
  let best: { side: Side; score: number; items: FurnitureSpec[] } | null = null;
  for (const side of opts.anchor ? [opts.anchor] : (['n', 's', 'w', 'e'] as Side[])) {
    const f = frameFor(room, side);
    const local = toLocal(f, openings);
    let avoid: Rect | null = null;
    if (opts.avoid) {
      const c = [
        { x: opts.avoid.x0, z: opts.avoid.z0 },
        { x: opts.avoid.x1, z: opts.avoid.z1 },
      ].map((q) => worldToLocal(room, side, q));
      avoid = { x0: Math.min(c[0].u, c[1].u), x1: Math.max(c[0].u, c[1].u), z0: Math.min(c[0].v, c[1].v), z1: Math.max(c[0].v, c[1].v) };
    }
    // Clearance from each wall centreline: half the wall plus a few centimetres.
    const inset: Record<LocalSide, number> = { back: 0.3, front: 0.3, left: 0.3, right: 0.3 };
    if (opts.wallHalf) for (const [sd, h] of Object.entries(opts.wallHalf) as [Side, number][]) inset[f.sideOf[sd]] = round(h + 0.03, 3);
    const items = furnishLocal({ ...room, x: 0, z: 0, width: f.W, depth: f.D }, local, { requested: opts.requested, avoid, buildingKind: opts.buildingKind, inset });
    const span = spanFinder(local, f.W, f.D);
    const doorFree = span('back', ['door'], 0.3, f.W - 0.3, 1.0).len;
    const solid = span('back', ['door', 'window'], 0.3, f.W - 0.3, 1.0).len;
    let score = layoutScore(items, local, f.W, f.D) + Math.min(doorFree, 5) * 0.1 + (side === 'n' ? 0.05 : 0);
    if (room.function === 'bedroom') score += solid >= 1.8 ? 0.3 : 0;
    if (!best || score > best.score + 1e-9) best = { side, score, items };
  }
  const f = frameFor(room, best!.side);
  const items = best!.items;
  return items
    .map((it) => {
      const w = f.toWorld(it.position.x, it.position.z);
      return { ...it, position: { ...it.position, x: round(w.x, 3), z: round(w.z, 3) }, rotation: normAngle(it.rotation + f.rot) };
    })
    .filter((it) => it.position.x >= room.x && it.position.x <= room.x + room.width && it.position.z >= room.z && it.position.z <= room.z + room.depth);
}

function normAngle(a: number) {
  let r = a % (2 * PI);
  if (r > PI + 1e-9) r -= 2 * PI;
  if (r <= -PI + 1e-9) r += 2 * PI;
  return round(r, 6);
}

function toLocal(f: Frame, openings: RoomOpening[]): LocalOpening[] {
  return openings.map((o) => {
    const [a, b] = f.along(o.side, o.a, o.b);
    return { kind: o.kind, side: f.sideOf[o.side], a, b };
  });
}

function worldToLocal(room: ProgramRoom, anchor: Side, q: { x: number; z: number }): { u: number; v: number } {
  const x0 = room.x;
  const z0 = room.z;
  const x1 = room.x + room.width;
  const z1 = room.z + room.depth;
  switch (anchor) {
    case 'n':
      return { u: q.x - x0, v: q.z - z0 };
    case 's':
      return { u: x1 - q.x, v: z1 - q.z };
    case 'w':
      return { u: z1 - q.z, v: q.x - x0 };
    case 'e':
      return { u: q.z - z0, v: x1 - q.x };
  }
}

/** Importance of a piece for a room to work (unlisted kinds count 1). */
const IMPORTANCE: Partial<Record<FurnitureKind, number>> = {
  bed: 12,
  sofa: 10,
  kitchen_counter: 12,
  toilet: 10,
  vanity: 8,
  shower: 9,
  bathtub: 9,
  dining_table: 9,
  desk: 4,
  wardrobe: 5,
  tv_unit: 3,
  kitchen_island: 4,
  coffee_table: 2,
  armchair: 2,
  nightstand: 1.5,
  office_chair: 1,
  chair: 1,
};

/**
 * Scores a local layout: importance of what was placed, minus pieces standing in a
 * door's passage zone or (when tall) against glazing. Rotations are multiples of 90°.
 */
function layoutScore(items: FurnitureSpec[], openings: LocalOpening[], W: number, D: number) {
  let score = 0;
  for (const it of items) {
    const imp = IMPORTANCE[it.kind] ?? 1;
    score += imp;
    if (it.kind === 'rug' || it.kind === 'pendant_lamp') continue;
    const turned = Math.abs(Math.sin(it.rotation)) > 0.5;
    const hw = (turned ? it.depth : it.width) / 2;
    const hd = (turned ? it.width : it.depth) / 2;
    const u0 = it.position.x - hw;
    const u1 = it.position.x + hw;
    const v0 = it.position.z - hd;
    const v1 = it.position.z + hd;
    for (const o of openings) {
      const reach = o.kind === 'door' ? DOOR_REACH : 0.4;
      if (o.kind === 'window' && it.height <= 1.1) continue;
      let hit = false;
      if (o.side === 'back') hit = u1 > o.a && u0 < o.b && v0 < reach;
      else if (o.side === 'front') hit = u1 > o.a && u0 < o.b && v1 > D - reach;
      else if (o.side === 'left') hit = v1 > o.a && v0 < o.b && u0 < reach;
      else hit = v1 > o.a && v0 < o.b && u1 > W - reach;
      // A conflicting piece still beats an empty room (the planner moves it later),
      // but a clean layout beats both.
      if (hit) score -= imp * 0.6 + 1;
    }
  }
  return score;
}

/** Layout presets in the local frame: back wall at z = 0, rotation 0 faces into the room (+z). */
function furnishLocal(room: ProgramRoom, openings: LocalOpening[], opts: { requested?: string[]; avoid?: Rect | null; buildingKind?: string; inset?: Record<LocalSide, number> }): FurnitureSpec[] {
  // Usable rectangle: wall faces plus a small gap (0.3 m from centrelines when walls are unknown).
  const m = opts.inset ?? { back: 0.3, front: 0.3, left: 0.3, right: 0.3 };
  const r: Rect = { x0: room.x + m.left, z0: room.z + m.back, x1: room.x + room.width - m.right, z1: room.z + room.depth - m.front };
  if (opts.avoid) {
    // Shrink the usable rect away from a stair void, keeping the larger remainder.
    const a = opts.avoid;
    if (a.x1 > r.x0 && a.x0 < r.x1 && a.z1 > r.z0 && a.z0 < r.z1) {
      const cuts: Rect[] = [
        { ...r, x0: Math.max(r.x0, a.x1 + 0.2) },
        { ...r, x1: Math.min(r.x1, a.x0 - 0.2) },
        { ...r, z0: Math.max(r.z0, a.z1 + 0.2) },
        { ...r, z1: Math.min(r.z1, a.z0 - 0.2) },
      ];
      const area = (q: Rect) => Math.max(0, q.x1 - q.x0) * Math.max(0, q.z1 - q.z0);
      Object.assign(r, cuts.sort((p, q) => area(q) - area(p))[0]);
    }
  }
  const w = r.x1 - r.x0;
  const d = r.z1 - r.z0;
  if (w < 0.8 || d < 0.8) return [];
  const cx = (r.x0 + r.x1) / 2;
  const cz = (r.z0 + r.z1) / 2;
  const out: FurnitureSpec[] = [];
  const isMaster = /master/i.test(room.name);
  const finder = spanFinder(openings, room.width, room.depth);
  const span = (side: LocalSide, kinds: ('door' | 'window')[], lo = side === 'back' || side === 'front' ? r.x0 : r.z0, hi = side === 'back' || side === 'front' ? r.x1 : r.z1, depth = 0.8) => finder(side, kinds, lo, hi, depth);
  /** Is a stretch of a side clear of the given openings? */
  const clear = (side: LocalSide, a: number, b: number, kinds: ('door' | 'window')[]) => !openings.some((o) => o.side === side && kinds.includes(o.kind) && o.b > a - 0.1 && o.a < b + 0.1);
  /** Inside a door's passage zone? */
  const inDoorZone = (x: number, z: number, pad = 0.35) =>
    openings.some((o) => {
      if (o.kind !== 'door') return false;
      if (o.side === 'back') return x > o.a - pad && x < o.b + pad && z < DOOR_REACH + pad;
      if (o.side === 'front') return x > o.a - pad && x < o.b + pad && z > room.depth - DOOR_REACH - pad;
      if (o.side === 'left') return z > o.a - pad && z < o.b + pad && x < DOOR_REACH + pad;
      return z > o.a - pad && z < o.b + pad && x > room.width - DOOR_REACH - pad;
    });
  /** A corner for a tall decorative piece: away from doors and glazing. */
  const quietCorner = (prefs: [number, number][]) => {
    for (const [px, pz] of prefs) {
      const x = px ? r.x1 - 0.3 : r.x0 + 0.3;
      const z = pz ? r.z1 - 0.3 : r.z0 + 0.3;
      const nearU: [number, number] = [x - 0.6, x + 0.6];
      const nearV: [number, number] = [z - 0.6, z + 0.6];
      if (!clear(pz ? 'front' : 'back', nearU[0], nearU[1], ['door', 'window'])) continue;
      if (!clear(px ? 'right' : 'left', nearV[0], nearV[1], ['door', 'window'])) continue;
      if (inDoorZone(x, z, 0.3)) continue;
      return { x, z };
    }
    return null;
  };
  /** Centre a piece of width pw inside a span (clamped to the room). */
  const centreIn = (sp: { a: number; b: number; mid: number }, pw: number, lo = r.x0, hi = r.x1) => Math.min(hi - pw / 2, Math.max(lo + pw / 2, sp.mid));

  switch (room.function) {
    case 'living': {
      if (d < 2.6 || w < 2.2) break;
      const back = span('back', ['door'], r.x0, r.x1, 1.1);
      const sofaW = round(Math.min(2.6, w * 0.6, Math.max(1.6, back.len)), 2);
      const sx = centreIn(back, sofaW);
      const seatDepth = Math.min(1.65, Math.max(1.3, d * 0.4));
      out.push(furnitureItem('rug', sx, r.z0 + seatDepth, 0, { width: Math.min(2.6, w * 0.7), depth: Math.min(1.9, d * 0.45) }));
      out.push(furnitureItem('sofa', sx, r.z0 + 0.5, 0, { width: sofaW }));
      out.push(furnitureItem('coffee_table', sx, r.z0 + seatDepth));
      const front = span('front', ['door']);
      const tvW = Math.min(1.8, w * 0.5);
      if (d > 3.6 && front.len >= tvW) out.push(furnitureItem('tv_unit', centreIn(front, tvW), r.z1 - 0.25, PI, { width: tvW }));
      if (w > 3.8) {
        // Armchair beside the sofa on whichever side has more room.
        const left = sx - sofaW / 2 - r.x0;
        const right = r.x1 - (sx + sofaW / 2);
        if (Math.max(left, right) > 1.1) out.push(left >= right ? furnitureItem('armchair', sx - sofaW / 2 - 0.8, r.z0 + seatDepth - 0.05, PI / 2) : furnitureItem('armchair', sx + sofaW / 2 + 0.8, r.z0 + seatDepth - 0.05, -PI / 2));
      }
      const plant = quietCorner([
        [1, 0],
        [0, 0],
        [1, 1],
        [0, 1],
      ]);
      if (plant && Math.abs(plant.x - sx) > sofaW / 2 + 0.3) out.push(furnitureItem('plant', plant.x, plant.z));
      // Reading lamp at the sofa end with the most space (and not on top of the plant).
      const lampL = sx - sofaW / 2 - 0.35;
      const lampR = sx + sofaW / 2 + 0.35;
      const lampOk = (x: number) => x > r.x0 + 0.2 && x < r.x1 - 0.2 && !(plant && Math.abs(plant.x - x) < 0.6 && plant.z < r.z0 + 1);
      if (w > 3.2) {
        const lx = lampOk(lampR) ? lampR : lampOk(lampL) ? lampL : null;
        if (lx !== null) out.push(furnitureItem('floor_lamp', lx, r.z0 + 0.3));
      }
      break;
    }
    case 'kitchen': {
      const back = span('back', ['door'], r.x0, r.x1, 0.7);
      const counterW = round(Math.min(back.len - 0.1, w - 0.2, 4.2), 2);
      if (counterW < 1.2) break;
      const kx = centreIn(back, counterW);
      out.push(furnitureItem('kitchen_counter', kx, r.z0 + 0.31, 0, { width: counterW }));
      if (w >= 3.4 && d >= 3.4) out.push(furnitureItem('kitchen_island', kx, r.z0 + 0.62 + 1.1 + 0.5, 0, { width: round(Math.min(2.4, w - 1.6, counterW), 2) }));
      break;
    }
    case 'dining': {
      if (w < 2.4 || d < 2.2) break;
      const long = w >= d;
      const tw = Math.min(2.2, (long ? w : d) - 1.4);
      out.push(furnitureItem('dining_table', cx, cz, long ? 0 : PI / 2, { width: round(Math.max(1.2, tw), 2) }));
      const n = tw >= 1.8 ? 3 : 2;
      for (let i = 0; i < n; i++) {
        const t = (i - (n - 1) / 2) * (tw / n);
        if (long) {
          out.push(furnitureItem('chair', cx + t, cz - 0.7, 0));
          out.push(furnitureItem('chair', cx + t, cz + 0.7, PI));
        } else {
          out.push(furnitureItem('chair', cx - 0.7, cz + t, PI / 2));
          out.push(furnitureItem('chair', cx + 0.7, cz + t, -PI / 2));
        }
      }
      out.push(furnitureItem('pendant_lamp', cx, cz, 0, { y: 1.9 }));
      break;
    }
    case 'bedroom': {
      if (d < 2.35 || w < 2.0) break;
      const bw = round(Math.max(0.9, isMaster ? Math.min(1.8, w - 1.2) : Math.min(1.4, w - 1.0)), 2);
      // Headboard against solid wall where possible, otherwise just clear of doors.
      const solid = span('back', ['door', 'window'], r.x0, r.x1, 2.2);
      const back = solid.len >= bw + 0.2 ? solid : span('back', ['door'], r.x0, r.x1, 2.2);
      const bx = centreIn(back, bw + (w - bw > 1.2 ? 1.2 : 0));
      const bedLen = 2.1;
      out.push(furnitureItem('bed', bx, r.z0 + bedLen / 2, 0, { width: bw }));
      if (w - bw > 1.2) {
        out.push(furnitureItem('nightstand', bx - bw / 2 - 0.3, r.z0 + 0.2));
        out.push(furnitureItem('nightstand', bx + bw / 2 + 0.3, r.z0 + 0.2));
      }
      // Wardrobe: opposite wall if there is a solid stretch for it, else a side wall
      // beyond the foot of the bed.
      const ww = Math.min(2.0, w - 1.0);
      const front = span('front', ['door', 'window']);
      if (d > 3.4 && front.len >= Math.min(ww, 1.2)) {
        const fw = round(Math.min(ww, front.len - 0.05), 2);
        out.push(furnitureItem('wardrobe', centreIn(front, fw), r.z1 - 0.3, PI, { width: fw }));
      } else if (d > bedLen + 1.6) {
        for (const side of ['left', 'right'] as const) {
          const sp = span(side, ['door', 'window'], r.z0 + bedLen + 0.6, r.z1);
          if (sp.len >= 1.0) {
            const fw = round(Math.min(1.8, sp.len - 0.05), 2);
            const z = Math.min(r.z1 - fw / 2, Math.max(r.z0 + bedLen + 0.6 + fw / 2, sp.mid));
            out.push(side === 'left' ? furnitureItem('wardrobe', r.x0 + 0.3, z, PI / 2, { width: fw }) : furnitureItem('wardrobe', r.x1 - 0.3, z, -PI / 2, { width: fw }));
            break;
          }
        }
      }
      out.push(furnitureItem('rug', bx, r.z0 + 1.4, 0, { width: round(Math.min(2.4, w - 0.4), 2), depth: 1.6 }));
      break;
    }
    case 'bathroom': {
      if (w < 1.4 || d < 1.0) break;
      if (opts.buildingKind === 'office' || /\bwc\b|toilet/i.test(room.name)) {
        // Office WC: a row of toilets on the back wall, basins opposite.
        const n = Math.max(1, Math.min(4, Math.floor(w / 1.0)));
        for (let i = 0; i < n; i++) out.push(furnitureItem('toilet', r.x0 + (w / n) * (i + 0.5), r.z0 + 0.33));
        if (d >= 2.2) {
          const nv = Math.max(1, Math.min(3, Math.floor(w / 1.4)));
          const fr = span('front', ['door']);
          for (let i = 0; i < nv && fr.len >= 1.0; i++) {
            const x = fr.a + (fr.len / nv) * (i + 0.5);
            out.push(furnitureItem('vanity', x, r.z1 - 0.25, PI, { width: Math.min(1.0, fr.len / nv - 0.1) }));
          }
        }
        break;
      }
      // Wet room: shower in the back corner, then basin and WC along the back wall
      // (the WC moves to a side wall when the back wall is full); a bath goes across
      // the far end instead of the shower when the room is long enough.
      const back = span('back', ['door']);
      let a = back.a;
      let b = back.b;
      const fr = span('front', ['door'], r.x0, r.x1, 0.8);
      const bath = w >= 2.0 && d >= 2.6 && fr.len >= 1.6;
      if (!bath && d >= 2.6 && back.len >= 1.6) {
        // Bath across the back wall; basin and WC on the front wall, or along a side wall
        // beyond the bath.
        const sideL = span('left', ['door'], r.z0 + 0.85, r.z1, 0.7);
        const sideR = span('right', ['door'], r.z0 + 0.85, r.z1, 0.7);
        if (fr.len >= 1.6 || Math.max(sideL.len, sideR.len) >= 1.6) {
          const bw = Math.min(1.7, back.len - 0.05);
          out.push(furnitureItem('bathtub', centreIn(back, bw), r.z0 + 0.38, 0, { width: round(bw, 2) }));
          if (fr.len >= 1.6) {
            const vw2 = fr.len >= 1.9 ? 1.0 : 0.7;
            out.push(furnitureItem('vanity', fr.b - vw2 / 2, r.z1 - 0.25, PI, { width: vw2 }));
            out.push(furnitureItem('toilet', fr.b - vw2 - 0.15 - 0.3, r.z1 - 0.33, PI));
          } else {
            const left = sideL.len >= sideR.len;
            const sp = left ? sideL : sideR;
            const vw2 = sp.len >= 1.9 ? 1.0 : 0.7;
            const x = left ? r.x0 : r.x1;
            const inward = left ? 1 : -1;
            const rot = left ? PI / 2 : -PI / 2;
            out.push(furnitureItem('toilet', x + inward * 0.33, sp.a + 0.3, rot));
            out.push(furnitureItem('vanity', x + inward * 0.25, sp.a + 0.75 + vw2 / 2, rot, { width: vw2 }));
          }
          break;
        }
      }
      if (bath) {
        const bw = Math.min(1.7, fr.len - 0.05);
        out.push(furnitureItem('bathtub', centreIn(fr, bw), r.z1 - 0.38, PI, { width: round(bw, 2) }));
      } else if (b - a >= 0.92 + 1.35 && clear('back', b - 0.9, b, ['window']) && clear('right', r.z0, r.z0 + 0.9, ['window'])) {
        out.push(furnitureItem('shower', b - 0.45, r.z0 + 0.45));
        b -= 0.92;
      }
      const placedShower = out.some((it) => it.kind === 'shower' || it.kind === 'bathtub');
      // Basin narrows before the WC loses its place.
      const vw = b - a >= 1.9 ? 1.0 : b - a >= 1.5 ? 0.7 : 0.6;
      if (b - a >= vw) {
        out.push(furnitureItem('vanity', a + vw / 2, r.z0 + 0.25, 0, { width: vw }));
        a += vw + 0.1;
      }
      if (b - a >= 0.68) out.push(furnitureItem('toilet', a + 0.34, r.z0 + 0.33));
      else {
        const side = span('left', ['door'], r.z0 + 0.8, r.z1, 0.7);
        if (side.len >= 0.8) out.push(furnitureItem('toilet', r.x0 + 0.33, side.a + 0.4, PI / 2));
      }
      if (!placedShower) {
        // Shower elsewhere: a corner without glazing or a door's swing.
        const spots = [
          { x: r.x1 - 0.45, z: r.z1 - 0.45, ok: d >= 2.0 && clear('front', r.x1 - 0.9, r.x1, ['window']) && clear('right', r.z1 - 0.9, r.z1, ['window']) },
          { x: r.x0 + 0.45, z: r.z1 - 0.45, ok: d >= 2.0 && clear('front', r.x0, r.x0 + 0.9, ['window']) && clear('left', r.z1 - 0.9, r.z1, ['window']) },
        ];
        const taken = (x: number, z: number) => out.some((it) => Math.abs(it.position.x - x) < 0.8 && Math.abs(it.position.z - z) < 0.8);
        const spot = spots.find((p) => p.ok && !inDoorZone(p.x, p.z, 0.45) && !taken(p.x, p.z));
        if (spot) out.push(furnitureItem('shower', spot.x, spot.z));
      }
      break;
    }
    case 'office': {
      if (/meeting/i.test(room.name)) {
        const long = w >= d;
        const tw = round(Math.max(1.4, Math.min(3.6, (long ? w : d) - 1.8)), 2);
        out.push(furnitureItem('dining_table', cx, cz, long ? 0 : PI / 2, { name: 'Meeting table', width: tw, depth: 1.1, material: 'walnut' }));
        const n = Math.max(1, Math.floor(tw / 0.7));
        for (let i = 0; i < n; i++) {
          const t = (i - (n - 1) / 2) * 0.7;
          if (long) {
            out.push(furnitureItem('office_chair', cx + t, cz - 0.8, 0));
            out.push(furnitureItem('office_chair', cx + t, cz + 0.8, PI));
          } else {
            out.push(furnitureItem('office_chair', cx - 0.8, cz + t, PI / 2));
            out.push(furnitureItem('office_chair', cx + 0.8, cz + t, -PI / 2));
          }
        }
        break;
      }
      // Desk rows with a 1.2 m aisle between back-to-back pairs.
      const cols = Math.max(1, Math.floor((w - 0.4) / 2.0));
      const rows = Math.max(1, Math.floor((d - 0.4) / 2.0));
      let k = 0;
      for (let i = 0; i < cols && k < 48; i++) {
        for (let j = 0; j < rows && k < 48; j++, k++) {
          const x = r.x0 + (w / cols) * (i + 0.5);
          const z = r.z0 + (d / rows) * (j + 0.5);
          out.push(furnitureItem('desk', x, z - 0.2, 0));
          out.push(furnitureItem('office_chair', x, z + 0.45, PI));
        }
      }
      break;
    }
    case 'storage': {
      // Shelving along the longest solid wall.
      const back = span('back', ['door', 'window'], r.x0, r.x1, 0.5);
      const n = Math.floor((back.len + 0.05) / 1.25);
      for (let i = 0; i < Math.min(n, 4); i++) out.push(furnitureItem('shelf', back.a + 0.6 + i * 1.25, r.z0 + 0.18, 0, {}));
      break;
    }
    case 'hall': {
      // A plant in a corner clear of doors and glazing.
      if (w > 1.0 && d > 1.5) {
        const c = quietCorner([
          [1, 1],
          [0, 1],
          [1, 0],
          [0, 0],
        ]);
        if (c) out.push(furnitureItem('plant', c.x, c.z));
      }
      break;
    }
    default:
      break;
  }

  // Specifically requested items not covered by the preset.
  const requested = (opts.requested ?? []).map((s) => s.toLowerCase());
  if (requested.length) {
    const have = new Set(out.map((f) => f.kind));
    let slot = 0;
    for (const req of requested) {
      const kind = matchFurnitureKind(req);
      if (!kind || have.has(kind)) continue;
      have.add(kind);
      const def = FURNITURE_DEFAULTS[kind];
      const x = r.x0 + def.w / 2 + slot;
      if (x + def.w / 2 > r.x1) break;
      out.push(furnitureItem(kind, x, r.z1 - def.d / 2, PI));
      slot += def.w + 0.4;
    }
  }
  return out;
}

const FURNITURE_WORDS: [RegExp, FurnitureKind][] = [
  [/sofa|couch|soffa/, 'sofa'],
  [/armchair|fåtölj|lounge chair/, 'armchair'],
  [/coffee table|soffbord/, 'coffee_table'],
  [/dining table|matbord|meeting table/, 'dining_table'],
  [/office chair|kontorsstol/, 'office_chair'],
  [/\bchair|stol\b/, 'chair'],
  [/\bbed\b|säng/, 'bed'],
  [/nightstand|bedside|nattduksbord/, 'nightstand'],
  [/wardrobe|closet|garderob/, 'wardrobe'],
  [/island|köksö/, 'kitchen_island'],
  [/counter|kitchen|kök|bänk/, 'kitchen_counter'],
  [/desk|skrivbord/, 'desk'],
  [/shelf|bookcase|hylla|bokhylla/, 'shelf'],
  [/rug|carpet|matta/, 'rug'],
  [/plant|växt/, 'plant'],
  [/floor lamp|golvlampa|lamp|lampa|warm light/, 'floor_lamp'],
  [/pendant|taklampa/, 'pendant_lamp'],
  [/tv|media/, 'tv_unit'],
  [/bathtub|bath tub|badkar/, 'bathtub'],
  [/shower|dusch/, 'shower'],
  [/toilet|wc|toalett/, 'toilet'],
  [/vanity|sink|handfat/, 'vanity'],
  [/lounger|sunbed|solstol/, 'lounger'],
];

export function matchFurnitureKind(text: string): FurnitureKind | undefined {
  const t = text.toLowerCase();
  for (const [re, kind] of FURNITURE_WORDS) if (re.test(t)) return kind;
  return undefined;
}
