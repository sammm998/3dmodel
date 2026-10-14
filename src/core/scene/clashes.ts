/**
 * Clash detection between building elements, and automatic resolution for
 * furniture. Checks, per storey:
 *  - furniture vs walls (bodies), stairs (flight and arrival void), door
 *    clearances (the zone a person needs to pass through and the leaf to
 *    swing), windows (tall pieces placed against glazing) and other furniture;
 *  - furniture standing outside every room.
 * Flat rugs and pendant lamps are exempt where appropriate, and chairs may
 * tuck under tables and desks.
 */
import type { DoorElement, Element, FurnitureElement, RoomElement, StairElement, Vec2, WallElement, WindowElement } from '../schema/elements';
import type { Scene } from '../schema/scene';
import { pointInPolygon } from '../geometry/math2d';
import { findElement, levelOf, pointAlongWall, wallFrame } from './query';

export interface Clash {
  elementId: string;
  otherId?: string;
  kind: 'wall' | 'door' | 'window' | 'stair' | 'furniture' | 'outside';
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
    // Candidates on a 10 cm grid (±1.6 m) in the piece's own frame, cheapest first: sliding
    // along the wall it backs onto costs little, moving out into the room costs more, and
    // turning costs extra. Large pieces that define a room are never turned sideways.
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
    let best: FurnitureElement | null = null;
    for (const c of cands) {
      // Local (u along width, v along depth) → plan.
      const dx = c.u * cos + c.v * sin;
      const dz = -c.u * sin + c.v * cos;
      const cand: FurnitureElement = { ...f, rotation: f.rotation + c.dr, position: { ...f.position, x: f.position.x + dx, z: f.position.z + dz } };
      if (room && !pointInPolygon({ x: cand.position.x, z: cand.position.z }, room.polygon)) continue;
      if (!furnitureClashes(ctx, cand, placed).length) {
        best = cand;
        break;
      }
    }
    if (best) {
      const r3 = (v: number) => Math.round(v * 1000) / 1000;
      best = { ...best, position: { ...best.position, x: r3(best.position.x), z: r3(best.position.z) } };
      placed.push(best);
      updated.set(f.id, best);
      moved.push(f.id);
    } else if (opts.keep) placed.push(f);
    else removed.push(f.id);
  }
  if (!moved.length && !removed.length) return { scene, moved, removed };
  const gone = new Set(removed);
  return {
    scene: { ...scene, elements: scene.elements.filter((e) => !gone.has(e.id)).map((e) => updated.get(e.id) ?? e) },
    moved,
    removed,
  };
}
