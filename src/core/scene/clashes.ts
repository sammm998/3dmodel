/**
 * Clash detection between building elements, and automatic resolution for
 * furniture. Checks, per storey:
 *  - furniture vs walls (bodies), stairs (flight and arrival void), door
 *    clearances (the zone a person needs to pass through and the leaf to
 *    swing), windows (tall pieces placed against glazing) and other furniture;
 *  - furniture standing outside every room.
 * Flat rugs and pendant lamps are exempt where appropriate, and chairs may
 * tuck under tables and desks. On top of that, every room must keep a walkable
 * way (about 0.6 m wide) between its doors and stair ends.
 */
import type { DoorElement, Element, FurnitureElement, RoomElement, StairElement, Vec2, WallElement, WindowElement } from '../schema/elements';
import type { Scene } from '../schema/scene';
import { pointInPolygon } from '../geometry/math2d';
import { findElement, levelOf, pointAlongWall, wallFrame } from './query';

export interface Clash {
  elementId: string;
  otherId?: string;
  kind: 'wall' | 'door' | 'window' | 'stair' | 'furniture' | 'outside' | 'passage';
  message: string;
}

/** Oriented rectangle in plan: centre, half extents and unit axes. */
export interface OBB {
  c: Vec2;
  hx: number;
  hz: number;
  ax: Vec2;
  az: Vec2;
}

export function obbCorners(o: OBB): Vec2[] {
  const p = (sx: number, sz: number) => ({ x: o.c.x + o.ax.x * o.hx * sx + o.az.x * o.hz * sz, z: o.c.z + o.ax.z * o.hx * sx + o.az.z * o.hz * sz });
  return [p(-1, -1), p(1, -1), p(1, 1), p(-1, 1)];
}

/** Penetration depth along the separating-axis test (<= 0: separated). */
export function obbOverlap(a: OBB, b: OBB): number {
  let min = Infinity;
  for (const axis of [a.ax, a.az, b.ax, b.az]) {
    const proj = (o: OBB) => {
      const c = o.c.x * axis.x + o.c.z * axis.z;
      const r = o.hx * Math.abs(o.ax.x * axis.x + o.ax.z * axis.z) + o.hz * Math.abs(o.az.x * axis.x + o.az.z * axis.z);
      return [c - r, c + r];
    };
    const [a0, a1] = proj(a);
    const [b0, b1] = proj(b);
    const o = Math.min(a1, b1) - Math.max(a0, b0);
    if (o <= 0) return o;
    min = Math.min(min, o);
  }
  return min;
}

/** Furniture footprint (rotation about Y as in the 3D builder). */
export function furnitureOBB(f: Pick<FurnitureElement, 'position' | 'rotation' | 'width' | 'depth'>, inflate = 0): OBB {
  const c = Math.cos(f.rotation);
  const s = Math.sin(f.rotation);
  return { c: { x: f.position.x, z: f.position.z }, hx: f.width / 2 + inflate, hz: f.depth / 2 + inflate, ax: { x: c, z: -s }, az: { x: s, z: c } };
}

function wallOBB(w: WallElement, along0 = 0, along1?: number, extraHalf = 0): OBB {
  const f = wallFrame(w);
  const a = along0;
  const b = along1 ?? f.length;
  const mid = (a + b) / 2;
  return {
    c: { x: w.start.x + f.dir.x * mid, z: w.start.z + f.dir.z * mid },
    hx: (b - a) / 2,
    hz: w.thickness / 2 + extraHalf,
    ax: f.dir,
    az: f.normal,
  };
}

function stairOBB(s: StairElement, extraFront = 0): OBB {
  const d = { x: -Math.sin(s.rotation), z: -Math.cos(s.rotation) };
  const side = { x: -d.z, z: d.x };
  const run = s.totalRun + extraFront;
  const mid = s.totalRun / 2 - extraFront / 2;
  return { c: { x: s.position.x + d.x * mid, z: s.position.z + d.z * mid }, hx: s.width / 2 + 0.05, hz: run / 2, ax: side, az: d };
}

const FLAT = (f: FurnitureElement) => f.kind === 'rug' || f.height < 0.05;
const OVERHEAD = (f: FurnitureElement) => f.kind === 'pendant_lamp' || f.position.y > 1.7;
const TUCKS = new Set(['chair', 'office_chair']);
const TABLES = new Set(['dining_table', 'desk', 'kitchen_island', 'coffee_table']);

/** Clearance zone a door needs: its width (minus frames) by 0.9 m either side of the wall. */
function doorZone(scene: Scene, d: DoorElement): OBB | null {
  const host = findElement(scene, d.hostId);
  if (!host || host.type !== 'wall') return null;
  const f = wallFrame(host);
  const p = pointAlongWall(host, d.offset);
  return { c: p, hx: d.width / 2, hz: host.thickness / 2 + 0.9, ax: f.dir, az: f.normal };
}

interface Context {
  scene: Scene;
  levelOfId: Map<string, string>;
  walls: Map<string, WallElement[]>;
  doors: Map<string, { d: DoorElement; zone: OBB }[]>;
  windows: Map<string, { w: WindowElement; zone: OBB }[]>;
  stairs: Map<string, { s: StairElement; obb: OBB; void: boolean }[]>;
  rooms: Map<string, RoomElement[]>;
}

function context(scene: Scene): Context {
  const levels = [...scene.levels].sort((a, b) => a.elevation - b.elevation);
  const lv = (e: Element) => levelOf(scene, e).id;
  const push = <T,>(m: Map<string, T[]>, k: string, v: T) => (m.get(k) ?? m.set(k, []).get(k)!).push(v);
  const ctx: Context = { scene, levelOfId: new Map(), walls: new Map(), doors: new Map(), windows: new Map(), stairs: new Map(), rooms: new Map() };
  for (const e of scene.elements) {
    if (e.hidden) continue;
    if (e.type === 'wall') push(ctx.walls, lv(e), e);
    else if (e.type === 'room') push(ctx.rooms, lv(e), e);
    else if (e.type === 'door') {
      const z = doorZone(scene, e);
      if (z) push(ctx.doors, lv(e), { d: e, zone: z });
    } else if (e.type === 'window') {
      const host = findElement(scene, e.hostId);
      if (host?.type === 'wall') {
        const f = wallFrame(host);
        // Pieces taller than the sill standing right against the glazing (either face).
        push(ctx.windows, lv(e), { w: e, zone: { c: pointAlongWall(host, e.offset), hx: e.width / 2, hz: host.thickness / 2 + 0.25, ax: f.dir, az: f.normal } });
      }
    } else if (e.type === 'stair') {
      const id = lv(e);
      push(ctx.stairs, id, { s: e, obb: stairOBB(e, 0.8), void: false });
      const i = levels.findIndex((l) => l.id === id);
      if (levels[i + 1]) push(ctx.stairs, levels[i + 1].id, { s: e, obb: stairOBB(e, 0), void: true });
    }
  }
  return ctx;
}

/** All clashes of one furniture piece against the building and the given other pieces. */
function furnitureClashes(ctx: Context, f: FurnitureElement, others: FurnitureElement[]): Clash[] {
  const out: Clash[] = [];
  const level = levelOf(ctx.scene, f).id;
  const box = furnitureOBB(f, -0.01);
  const y0 = f.position.y;
  const y1 = f.position.y + f.height;
  if (FLAT(f) || OVERHEAD(f)) {
    // Rugs and pendants only need to be inside a room and clear of stairs.
  } else {
    for (const w of ctx.walls.get(level) ?? []) {
      if (y0 >= w.baseOffset + w.height || y1 <= w.baseOffset) continue;
      if (obbOverlap(box, wallOBB(w)) > 0.005) out.push({ elementId: f.id, otherId: w.id, kind: 'wall', message: `${f.name} intersects ${w.name}` });
    }
    for (const { d, zone } of ctx.doors.get(level) ?? []) {
      if (obbOverlap(box, zone) > 0.02) out.push({ elementId: f.id, otherId: d.id, kind: 'door', message: `${f.name} blocks ${d.name}` });
    }
    for (const { w, zone } of ctx.windows.get(level) ?? []) {
      if (y1 > w.sillHeight + 0.05 && f.height > 1.1 && obbOverlap(box, zone) > 0.02) out.push({ elementId: f.id, otherId: w.id, kind: 'window', message: `${f.name} stands in front of ${w.name}` });
    }
  }
  if (!OVERHEAD(f)) {
    for (const { s, obb, void: isVoid } of ctx.stairs.get(level) ?? []) {
      if (obbOverlap(box, obb) > 0.02) out.push({ elementId: f.id, otherId: s.id, kind: 'stair', message: isVoid ? `${f.name} stands over the stair opening of ${s.name}` : `${f.name} blocks ${s.name}` });
    }
  }
  const rooms = ctx.rooms.get(level) ?? [];
  const outdoor = f.kind === 'lounger';
  if (!outdoor && rooms.length && !rooms.some((r) => pointInPolygon({ x: f.position.x, z: f.position.z }, r.polygon))) {
    out.push({ elementId: f.id, kind: 'outside', message: `${f.name} stands outside the rooms` });
  }
  for (const o of others) {
    if (o.id === f.id || levelOf(ctx.scene, o).id !== level) continue;
    if (FLAT(f) || FLAT(o)) continue;
    if (y0 >= o.position.y + o.height || y1 <= o.position.y) continue;
    if ((TUCKS.has(f.kind) && TABLES.has(o.kind)) || (TUCKS.has(o.kind) && TABLES.has(f.kind))) continue;
    if (obbOverlap(box, furnitureOBB(o, -0.01)) > 0.01) out.push({ elementId: f.id, otherId: o.id, kind: 'furniture', message: `${f.name} overlaps ${o.name}` });
  }
  return out;
}

/** Furniture clashes in a scene (each pair reported once). */
export function findClashes(scene: Scene): Clash[] {
  const ctx = context(scene);
  const furniture = scene.elements.filter((e): e is FurnitureElement => e.type === 'furniture' && !e.hidden);
  const out: Clash[] = [];
  furniture.forEach((f, i) => out.push(...furnitureClashes(ctx, f, furniture.slice(0, i))));
  out.push(...findBlockedPassages(scene, ctx, furniture));
  return out;
}

// ---- walkways -----------------------------------------------------------------------

/** Grid step and the clear half-width a person needs (so ~0.6 m wide passages). */
const CELL = 0.1;
const BODY = 0.3;

interface RoomGrid {
  room: RoomElement;
  x0: number;
  z0: number;
  nx: number;
  nz: number;
  /** Walkable ignoring furniture. */
  base: Uint8Array;
  /** Required points (door thresholds, stair ends) as cell indices. */
  points: { cell: number; label: string }[];
}

function distToSegment(p: Vec2, a: Vec2, b: Vec2) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
  return Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t);
}

function inOBB(p: Vec2, o: OBB, inflate: number) {
  const dx = p.x - o.c.x;
  const dz = p.z - o.c.z;
  return Math.abs(dx * o.ax.x + dz * o.ax.z) <= o.hx + inflate && Math.abs(dx * o.az.x + dz * o.az.z) <= o.hz + inflate;
}

function roomGrid(ctx: Context, level: string, room: RoomElement): RoomGrid | null {
  const poly = room.polygon;
  if (poly.length < 3) return null;
  const x0 = Math.min(...poly.map((p) => p.x));
  const z0 = Math.min(...poly.map((p) => p.z));
  const nx = Math.ceil((Math.max(...poly.map((p) => p.x)) - x0) / CELL);
  const nz = Math.ceil((Math.max(...poly.map((p) => p.z)) - z0) / CELL);
  if (nx * nz > 400_000 || nx < 2 || nz < 2) return null;
  const base = new Uint8Array(nx * nz);
  const stairs = ctx.stairs.get(level) ?? [];
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const p = { x: x0 + (i + 0.5) * CELL, z: z0 + (j + 0.5) * CELL };
      if (!pointInPolygon(p, poly)) continue;
      let near = false;
      for (let k = 0, l = poly.length - 1; k < poly.length; l = k++) if (distToSegment(p, poly[l], poly[k]) < BODY) near = true;
      if (near) continue;
      // The flight below, the opening above.
      if (stairs.some(({ s }) => inOBB(p, stairOBB(s, 0), 0.15))) continue;
      base[j * nx + i] = 1;
    }
  const cellOf = (p: Vec2, reach = 0.4) => {
    // Nearest walkable cell within `reach` of the point.
    let best = -1;
    let bestD = reach;
    const ci = Math.floor((p.x - x0) / CELL);
    const cj = Math.floor((p.z - z0) / CELL);
    const n = Math.ceil(reach / CELL);
    for (let dj = -n; dj <= n; dj++)
      for (let di = -n; di <= n; di++) {
        const i = ci + di;
        const j = cj + dj;
        if (i < 0 || j < 0 || i >= nx || j >= nz || !base[j * nx + i]) continue;
        const d = Math.hypot(x0 + (i + 0.5) * CELL - p.x, z0 + (j + 0.5) * CELL - p.z);
        if (d < bestD) {
          bestD = d;
          best = j * nx + i;
        }
      }
    return best;
  };
  const points: { cell: number; label: string }[] = [];
  for (const { d } of ctx.doors.get(level) ?? []) {
    const host = findElement(ctx.scene, d.hostId);
    if (!host || host.type !== 'wall') continue;
    const f = wallFrame(host);
    const p = pointAlongWall(host, d.offset);
    for (const sgn of [1, -1]) {
      const q = { x: p.x + f.normal.x * sgn * (host.thickness / 2 + 0.45), z: p.z + f.normal.z * sgn * (host.thickness / 2 + 0.45) };
      if (!pointInPolygon(q, poly)) continue;
      const cell = cellOf(q);
      if (cell >= 0) points.push({ cell, label: d.name });
    }
  }
  for (const { s, void: isVoid } of stairs) {
    const dir = { x: -Math.sin(s.rotation), z: -Math.cos(s.rotation) };
    // Where you step on (the first tread may be approached from the side) or off.
    const t = isVoid ? s.totalRun + 0.45 : -0.15;
    const q = { x: s.position.x + dir.x * t, z: s.position.z + dir.z * t };
    if (!pointInPolygon(q, poly)) continue;
    const cell = cellOf(q, isVoid ? 0.4 : 1.0);
    if (cell >= 0) points.push({ cell, label: s.name });
  }
  return { room, x0, z0, nx, nz, base, points };
}

const grids = new WeakMap<Context, Map<string, RoomGrid | null>>();
function gridCache(ctx: Context, level: string, room: RoomElement) {
  const m = grids.get(ctx) ?? grids.set(ctx, new Map()).get(ctx)!;
  if (!m.has(room.id)) m.set(room.id, roomGrid(ctx, level, room));
  return m.get(room.id)!;
}

const PASSABLE = (f: FurnitureElement) => FLAT(f) || OVERHEAD(f) || TUCKS.has(f.kind);

/** Labels of required points that cannot be reached from the first one. */
function unreachable(g: RoomGrid, pieces: FurnitureElement[]): string[] {
  if (g.points.length < 2) return [];
  const free = g.base.slice();
  for (const f of pieces) {
    if (PASSABLE(f)) continue;
    const o = furnitureOBB(f);
    const r = Math.hypot(o.hx, o.hz) + BODY;
    const i0 = Math.max(0, Math.floor((f.position.x - r - g.x0) / CELL));
    const i1 = Math.min(g.nx - 1, Math.ceil((f.position.x + r - g.x0) / CELL));
    const j0 = Math.max(0, Math.floor((f.position.z - r - g.z0) / CELL));
    const j1 = Math.min(g.nz - 1, Math.ceil((f.position.z + r - g.z0) / CELL));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const k = j * g.nx + i;
        if (free[k] && inOBB({ x: g.x0 + (i + 0.5) * CELL, z: g.z0 + (j + 0.5) * CELL }, o, BODY - 0.05)) free[k] = 0;
      }
  }
  const start = g.points[0].cell;
  if (!free[start]) return [];
  const seen = new Uint8Array(free.length);
  const queue = [start];
  seen[start] = 1;
  while (queue.length) {
    const k = queue.pop()!;
    const i = k % g.nx;
    const ns = [i > 0 ? k - 1 : -1, i < g.nx - 1 ? k + 1 : -1, k - g.nx, k + g.nx];
    for (const n of ns) if (n >= 0 && n < free.length && free[n] && !seen[n]) {
      seen[n] = 1;
      queue.push(n);
    }
  }
  // A threshold covered by a piece is reported as a door clash already.
  return g.points.filter((p) => free[p.cell] && !seen[p.cell]).map((p) => p.label);
}

function inRoom(f: FurnitureElement, room: RoomElement) {
  return pointInPolygon({ x: f.position.x, z: f.position.z }, room.polygon);
}

/**
 * Rooms where furniture closes off the way between doors (and stair ends). Each
 * piece whose removal would reopen the way is reported; if none does on its own,
 * the room is.
 */
export function findBlockedPassages(
  scene: Scene,
  ctx = context(scene),
  furniture = scene.elements.filter((e): e is FurnitureElement => e.type === 'furniture' && !e.hidden),
  opts: { room?: string; blame?: boolean } = {},
): Clash[] {
  const out: Clash[] = [];
  for (const [level, rooms] of ctx.rooms) {
    for (const room of rooms) {
      if (opts.room && room.id !== opts.room) continue;
      const g = gridCache(ctx, level, room);
      if (!g || g.points.length < 2) continue;
      const pieces = furniture.filter((f) => levelOf(scene, f).id === level && inRoom(f, room));
      const cut = unreachable(g, pieces);
      if (!cut.length) continue;
      if (opts.blame === false) {
        out.push({ elementId: room.id, kind: 'passage', message: `Furniture blocks the way to ${cut[0]} in ${room.name}` });
        continue;
      }
      const culprits = pieces.filter((f) => !PASSABLE(f) && !unreachable(g, pieces.filter((o) => o !== f)).length);
      if (culprits.length) for (const f of culprits) out.push({ elementId: f.id, otherId: room.id, kind: 'passage', message: `${f.name} blocks the way to ${cut[0]} in ${room.name}` });
      else out.push({ elementId: room.id, kind: 'passage', message: `Furniture blocks the way to ${cut[0]} in ${room.name}` });
    }
  }
  return out;
}

/** Placement order: the pieces that define a room first. */
const PRIORITY: Record<string, number> = {
  kitchen_counter: 0,
  bed: 1,
  sofa: 1,
  bathtub: 1,
  shower: 1,
  toilet: 2,
  vanity: 2,
  dining_table: 2,
  desk: 2,
  wardrobe: 3,
  kitchen_island: 3,
  tv_unit: 3,
  coffee_table: 4,
  nightstand: 5,
  armchair: 5,
  chair: 6,
  office_chair: 6,
  shelf: 6,
  floor_lamp: 7,
  plant: 7,
  rug: 8,
  pendant_lamp: 9,
};

/**
 * Nearest free spot for a piece: candidates on a 10 cm grid (±1.6 m) in the piece's
 * own frame, cheapest first. Sliding along the wall it backs onto costs little,
 * moving out into the room costs more, and turning costs extra. Large pieces that
 * define a room are never turned sideways. `accept` adds a further condition.
 */
function findSpot(ctx: Context, scene: Scene, f: FurnitureElement, placed: FurnitureElement[], accept?: (cand: FurnitureElement) => boolean): FurnitureElement | null {
  const level = levelOf(scene, f).id;
  const room = (ctx.rooms.get(level) ?? []).find((r) => pointInPolygon({ x: f.position.x, z: f.position.z }, r.polygon));
  const rots = f.kind === 'bed' || f.kind === 'sofa' || f.kind === 'kitchen_counter' ? [0, Math.PI] : [0, Math.PI / 2, -Math.PI / 2, Math.PI];
  const cos = Math.cos(f.rotation);
  const sin = Math.sin(f.rotation);
  const cands: { u: number; v: number; dr: number; cost: number }[] = [];
  for (let i = -16; i <= 16; i++)
    for (let j = -16; j <= 16; j++)
      rots.forEach((dr, k) => {
        if (i === 0 && j === 0 && dr === 0) return;
        cands.push({ u: i / 10, v: j / 10, dr, cost: Math.abs(i / 10) + 3 * Math.abs(j / 10) + k * 0.6 });
      });
  cands.sort((p, q) => p.cost - q.cost);
  for (const c of cands) {
    // Local (u along width, v along depth) → plan.
    const dx = c.u * cos + c.v * sin;
    const dz = -c.u * sin + c.v * cos;
    const r3 = (v: number) => Math.round(v * 1000) / 1000;
    const cand: FurnitureElement = { ...f, rotation: f.rotation + c.dr, position: { ...f.position, x: r3(f.position.x + dx), z: r3(f.position.z + dz) } };
    if (room && !pointInPolygon({ x: cand.position.x, z: cand.position.z }, room.polygon)) continue;
    if (furnitureClashes(ctx, cand, placed).length) continue;
    if (accept && !accept(cand)) continue;
    return cand;
  }
  return null;
}

/**
 * Moves (and if needed turns) clashing furniture to the nearest free spot in
 * its room, or removes it when there is none. Returns the new scene and what
 * was changed.
 */
export function resolveFurnitureClashes(scene: Scene, opts: { only?: string[]; keep?: boolean } = {}): { scene: Scene; moved: string[]; removed: string[] } {
  const ctx = context(scene);
  const furniture = scene.elements.filter((e): e is FurnitureElement => e.type === 'furniture' && !e.hidden);
  // With `only`, every other piece stays where it is and only these are re-placed.
  const only = opts.only ? new Set(opts.only) : null;
  const placed: FurnitureElement[] = only ? furniture.filter((f) => !only.has(f.id)) : [];
  const order = [...furniture].filter((f) => !only || only.has(f.id)).sort((a, b) => (PRIORITY[a.kind] ?? 5) - (PRIORITY[b.kind] ?? 5));
  const moved: string[] = [];
  const removed: string[] = [];
  const updated = new Map<string, FurnitureElement>();
  for (const f of order) {
    if (!furnitureClashes(ctx, f, placed).length) {
      placed.push(f);
      continue;
    }
    const best = findSpot(ctx, scene, f, placed);
    if (best) {
      placed.push(best);
      updated.set(f.id, best);
      moved.push(f.id);
    } else if (opts.keep) placed.push(f);
    else removed.push(f.id);
  }

  // Walkways: a piece that closes the way between a room's doors is moved to a spot
  // that keeps it open, or (least important first) left out.
  for (let round = 0; round < 6; round++) {
    const current = [...placed];
    const blocked = findBlockedPassages(scene, ctx, current).filter((c) => c.kind === 'passage');
    const culprits = blocked
      .map((c) => current.find((f) => f.id === c.elementId))
      .filter((f): f is FurnitureElement => !!f && (!only || only.has(f.id)))
      .sort((a, b) => (PRIORITY[b.kind] ?? 5) - (PRIORITY[a.kind] ?? 5));
    if (!culprits.length) break;
    const f = culprits[0];
    const rest = current.filter((o) => o.id !== f.id);
    const roomId = blocked.find((c) => c.elementId === f.id)?.otherId;
    const spot = roomId ? findSpot(ctx, scene, f, rest, (cand) => !findBlockedPassages(scene, ctx, [...rest, cand], { room: roomId, blame: false }).length) : null;
    placed.splice(placed.indexOf(f), 1);
    if (spot) {
      placed.push(spot);
      updated.set(f.id, spot);
      if (!moved.includes(f.id)) moved.push(f.id);
    } else if (opts.keep) {
      placed.push(f);
      break;
    } else {
      updated.delete(f.id);
      const i = moved.indexOf(f.id);
      if (i >= 0) moved.splice(i, 1);
      removed.push(f.id);
    }
  }
  if (!moved.length && !removed.length) return { scene, moved, removed };
  const gone = new Set(removed);
  return {
    scene: { ...scene, elements: scene.elements.filter((e) => !gone.has(e.id)).map((e) => updated.get(e.id) ?? e) },
    moved,
    removed,
  };
}
