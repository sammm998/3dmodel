/**
 * Drone flight through a model, computed from its real elements:
 * an exterior establishing orbit, in through the main entrance, room by room
 * through door openings (never through walls), up the stairs to every storey,
 * and an exterior pull-back at the end.
 *
 * Interior routing is a visibility graph per storey: room interior points,
 * points either side of every door, and stair ends. Two nodes are connected
 * when the straight line between them keeps clear of every wall and stair
 * flight; door nodes are connected through their opening.
 */
import type { Scene } from '../schema/scene';
import type { DoorElement, RoomElement, StairElement, Vec2, WallElement } from '../schema/elements';
import { pointInPolygon, polygonArea, polygonCentroid } from '../geometry/math2d';
import { findElement, pointAlongWall, sceneBounds, wallFrame } from '../scene/query';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface DronePlan {
  center: Vec3;
  /** Horizontal radius of the building footprint (metres). */
  radius: number;
  /** Building height (metres). */
  height: number;
  /** Where the exterior orbit ends and the interior flight begins (outside the main door). */
  approach: Vec3 | null;
  /** Interior flight polyline (starts at `approach`); empty when there is no way in. */
  interior: Vec3[];
  /** Room names in visiting order (for captions and tests). */
  visited: string[];
}

/** Drone height above the floor indoors (eye level, above most furniture). */
export const INDOOR_HEIGHT = 1.6;
/** Minimum clearance between the flight line and any wall or stair flight. */
const CLEARANCE = 0.38;
/** Distance of door nodes from the wall plane on either side. */
const DOOR_STANDOFF = 0.9;

interface Node {
  id: number;
  level: string;
  p: Vec2;
  /** Absolute floor height. */
  y: number;
  roomId?: string;
}

interface Edge {
  to: number;
  len: number;
  /** Intermediate points (e.g. a door centre or the stair line). */
  via: Vec3[];
}

/** Rectangle footprint of a wall (centre line ± half thickness), in plan. */
function wallRect(w: WallElement) {
  const f = wallFrame(w);
  return { a: w.start, b: w.end, dir: f.dir, n: f.normal, len: f.length, half: w.thickness / 2 };
}

type Rect = ReturnType<typeof wallRect>;

/** Distance from point to segment. */
function distPointSeg(p: Vec2, a: Vec2, b: Vec2) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l2 = dx * dx + dz * dz;
  const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
}

function segsIntersect(p1: Vec2, p2: Vec2, q1: Vec2, q2: Vec2) {
  const o = (a: Vec2, b: Vec2, c: Vec2) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  const d1 = o(q1, q2, p1);
  const d2 = o(q1, q2, p2);
  const d3 = o(p1, p2, q1);
  const d4 = o(p1, p2, q2);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Minimum distance between two segments. */
function distSegSeg(p1: Vec2, p2: Vec2, q1: Vec2, q2: Vec2) {
  if (segsIntersect(p1, p2, q1, q2)) return 0;
  return Math.min(distPointSeg(p1, q1, q2), distPointSeg(p2, q1, q2), distPointSeg(q1, p1, p2), distPointSeg(q2, p1, p2));
}

/** True when the segment a→b keeps `clearance` from the wall body (wall rectangle). */
function clearOfWall(a: Vec2, b: Vec2, r: Rect, clearance: number) {
  return distSegSeg(a, b, r.a, r.b) > r.half + clearance;
}

/** A point well inside the room (centroid when it is inside and clear, else the most interior grid sample). */
function roomInteriorPoint(poly: Vec2[]): Vec2 {
  const edgeDist = (p: Vec2) => Math.min(...poly.map((a, i) => distPointSeg(p, a, poly[(i + 1) % poly.length])));
  const c = polygonCentroid(poly);
  if (pointInPolygon(c, poly) && edgeDist(c) > 0.8) return c;
  const xs = poly.map((p) => p.x);
  const zs = poly.map((p) => p.z);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  let best = c;
  let bestD = -1;
  for (let i = 1; i < 16; i++)
    for (let j = 1; j < 16; j++) {
      const p = { x: x0 + ((x1 - x0) * i) / 16, z: z0 + ((z1 - z0) * j) / 16 };
      if (!pointInPolygon(p, poly)) continue;
      const d = edgeDist(p);
      if (d > bestD) {
        bestD = d;
        best = p;
      }
    }
  return best;
}

const levelId = (scene: Scene, id: string | undefined) => id ?? scene.levels[0]?.id;

export function planDroneFlight(scene: Scene): DronePlan {
  const b = sceneBounds(scene);
  const levels = [...scene.levels].sort((a, c) => a.elevation - c.elevation);
  const center: Vec3 = b ? { x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2, z: (b.min.z + b.max.z) / 2 } : { x: 0, y: 1.5, z: 0 };
  // Footprint of the building itself (walls), not the whole site.
  const walls = scene.elements.filter((e): e is WallElement => e.type === 'wall' && !e.hidden);
  const wx = walls.flatMap((w) => [w.start.x, w.end.x]);
  const wz = walls.flatMap((w) => [w.start.z, w.end.z]);
  const fp = wx.length ? { x0: Math.min(...wx), x1: Math.max(...wx), z0: Math.min(...wz), z1: Math.max(...wz) } : b ? { x0: b.min.x, x1: b.max.x, z0: b.min.z, z1: b.max.z } : { x0: -5, x1: 5, z0: -5, z1: 5 };
  const bc = { x: (fp.x0 + fp.x1) / 2, z: (fp.z0 + fp.z1) / 2 };
  const radius = Math.max(4, Math.hypot(fp.x1 - fp.x0, fp.z1 - fp.z0) / 2);
  const height = b ? Math.max(3, b.max.y - (levels[0]?.elevation ?? 0)) : 3;
  const plan: DronePlan = { center: { x: bc.x, y: center.y, z: bc.z }, radius, height, approach: null, interior: [], visited: [] };
  if (!levels.length || !walls.length) return plan;

  const elev = new Map(levels.map((l) => [l.id, l.elevation]));
  const nodes: Node[] = [];
  const edges = new Map<number, Edge[]>();
  const addNode = (level: string, p: Vec2, roomId?: string) => {
    const n: Node = { id: nodes.length, level, p, y: elev.get(level) ?? 0, roomId };
    nodes.push(n);
    edges.set(n.id, []);
    return n;
  };
  const link = (a: Node, c: Node, via: Vec3[] = []) => {
    const len = Math.hypot(a.p.x - c.p.x, a.p.z - c.p.z) + Math.abs(a.y - c.y);
    edges.get(a.id)!.push({ to: c.id, len, via });
    edges.get(c.id)!.push({ to: a.id, len, via: [...via].reverse() });
  };

  // Obstacles per storey: walls and stair flights.
  const wallsBy = new Map<string, Rect[]>();
  for (const w of walls) {
    const lv = levelId(scene, w.levelId)!;
    (wallsBy.get(lv) ?? wallsBy.set(lv, []).get(lv)!).push(wallRect(w));
  }
  const stairs = scene.elements.filter((e): e is StairElement => e.type === 'stair' && !e.hidden);
  const stairObstacles = new Map<string, { a: Vec2; b: Vec2; half: number }[]>();
  const stairDir = (s: StairElement) => ({ x: -Math.sin(s.rotation), z: -Math.cos(s.rotation) });
  for (const s of stairs) {
    const lv = levelId(scene, s.levelId)!;
    const d = stairDir(s);
    const seg = { a: s.position, b: { x: s.position.x + d.x * s.totalRun, z: s.position.z + d.z * s.totalRun }, half: s.width / 2 };
    (stairObstacles.get(lv) ?? stairObstacles.set(lv, []).get(lv)!).push(seg);
    // The flight also passes through the storey above (its void): keep clear there too.
    const above = levels[levels.findIndex((l) => l.id === lv) + 1];
    if (above) (stairObstacles.get(above.id) ?? stairObstacles.set(above.id, []).get(above.id)!).push(seg);
  }
  const visible = (level: string, a: Vec2, c: Vec2) =>
    (wallsBy.get(level) ?? []).every((r) => clearOfWall(a, c, r, CLEARANCE)) &&
    (stairObstacles.get(level) ?? []).every((s) => distSegSeg(a, c, s.a, s.b) > s.half + CLEARANCE);

  // Room nodes.
  const rooms = scene.elements.filter((e): e is RoomElement => e.type === 'room' && !e.hidden && Math.abs(polygonArea(e.polygon)) > 2.5);
  const roomNode = new Map<string, Node>();
  for (const r of rooms) roomNode.set(r.id, addNode(levelId(scene, r.levelId)!, roomInteriorPoint(r.polygon), r.id));

  // Door nodes (both sides), linked through the opening.
  const doors = scene.elements.filter((e): e is DoorElement => e.type === 'door' && !e.hidden);
  let entrance: { outside: Node; inside: Node; door: DoorElement; out: Vec2 } | null = null;
  for (const d of doors) {
    const host = findElement(scene, d.hostId);
    if (!host || host.type !== 'wall') continue;
    const lv = levelId(scene, host.levelId)!;
    const p = pointAlongWall(host, d.offset);
    const n = wallFrame(host).normal;
    const a = addNode(lv, { x: p.x + n.x * DOOR_STANDOFF, z: p.z + n.z * DOOR_STANDOFF });
    const c = addNode(lv, { x: p.x - n.x * DOOR_STANDOFF, z: p.z - n.z * DOOR_STANDOFF });
    const y = (elev.get(lv) ?? 0) + INDOOR_HEIGHT;
    link(a, c, [{ x: p.x, y, z: p.z }]);
    if (host.exterior && lv === levels[0].id) {
      // Outside = the side away from the building centre.
      const toCenter = (bc.x - p.x) * n.x + (bc.z - p.z) * n.z;
      const [outside, inside] = toCenter > 0 ? [c, a] : [a, c];
      const out = toCenter > 0 ? { x: -n.x, z: -n.z } : { x: n.x, z: n.z };
      const score = (dd: DoorElement) => (/main|entr/i.test(dd.name) ? 2 : 0) + (dd.doorType !== 'garage' ? 1 : 0);
      if (!entrance || score(d) > score(entrance.door)) entrance = { outside, inside, door: d, out };
    }
  }

  // Stair nodes: in front of the first step and beyond the last one, linked along the flight.
  for (const s of stairs) {
    const lv = levelId(scene, s.levelId)!;
    const i = levels.findIndex((l) => l.id === lv);
    const up = levels[i + 1];
    if (!up) continue;
    const d = stairDir(s);
    const side = { x: -d.z, z: d.x };
    // Stand-off points that are inside a room and clear of walls: in front of the first step
    // (or beside the lower steps when the flight starts at a wall), beyond the last step (or beside it).
    const free = (level: string, q: Vec2) =>
      rooms.some((r) => levelId(scene, r.levelId) === level && pointInPolygon(q, r.polygon)) &&
      (wallsBy.get(level) ?? []).every((w) => distPointSeg(q, w.a, w.b) > w.half + 0.4);
    const off = s.width / 2 + 0.7;
    const at = (t: number, sd: number, extra = 0) => ({ x: s.position.x + d.x * (s.totalRun * t + extra) + side.x * sd, z: s.position.z + d.z * (s.totalRun * t + extra) + side.z * sd });
    const bottomP = [at(0, 0, -0.8), at(0, off, 0.3), at(0, -off, 0.3)].find((q) => free(lv, q));
    const topP = [at(1, 0, 0.8), at(1, off, -0.3), at(1, -off, -0.3)].find((q) => free(up.id, q));
    if (!bottomP || !topP) continue;
    const bottom = addNode(lv, bottomP);
    const top = addNode(up.id, topP);
    const via: Vec3[] = [];
    const y0 = (elev.get(lv) ?? 0) + s.baseOffset;
    for (let k = 0; k <= 4; k++) {
      const t = k / 4;
      via.push({ x: s.position.x + d.x * s.totalRun * t, y: y0 + s.totalRise * t + INDOOR_HEIGHT, z: s.position.z + d.z * s.totalRun * t });
    }
    link(bottom, top, via);
  }

  // Visibility edges within each storey.
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const c = nodes[j];
      if (a.level !== c.level) continue;
      if (Math.hypot(a.p.x - c.p.x, a.p.z - c.p.z) < 0.05) continue;
      if (visible(a.level, a.p, c.p)) link(a, c);
    }

  if (!entrance) return plan;
  const outsideY = (elev.get(levels[0].id) ?? 0) + INDOOR_HEIGHT;
  plan.approach = { x: entrance.outside.p.x + entrance.out.x * 6, y: outsideY + 1.2, z: entrance.outside.p.z + entrance.out.z * 6 };

  // Dijkstra from a node; returns distance and predecessor maps.
  const dijkstra = (src: number) => {
    const dist = new Map<number, number>([[src, 0]]);
    const prev = new Map<number, { from: number; edge: Edge }>();
    const open = new Set<number>([src]);
    while (open.size) {
      let u = -1;
      let best = Infinity;
      for (const k of open) if ((dist.get(k) ?? Infinity) < best) [best, u] = [dist.get(k)!, k];
      open.delete(u);
      for (const e of edges.get(u) ?? []) {
        const nd = best + e.len;
        if (nd < (dist.get(e.to) ?? Infinity)) {
          dist.set(e.to, nd);
          prev.set(e.to, { from: u, edge: e });
          open.add(e.to);
        }
      }
    }
    return { dist, prev };
  };

  // Visiting order: storey by storey, nearest reachable unvisited room next.
  const route: Vec3[] = [];
  const push = (p: Vec3) => {
    const last = route[route.length - 1];
    if (!last || Math.hypot(last.x - p.x, last.y - p.y, last.z - p.z) > 0.15) route.push(p);
  };
  const at = (n: Node): Vec3 => ({ x: n.p.x, y: n.y + INDOOR_HEIGHT, z: n.p.z });
  push(plan.approach);
  push(at(entrance.outside));
  let cur = entrance.outside.id;
  const visitedRooms = new Set<string>();
  const goTo = (target: number) => {
    const { prev } = dijkstra(cur);
    if (target !== cur && !prev.has(target)) return false;
    const chain: { from: number; edge: Edge }[] = [];
    for (let k = target; k !== cur; k = prev.get(k)!.from) chain.unshift(prev.get(k)!);
    for (const step of chain) {
      for (const v of step.edge.via) push(v);
      push(at(nodes[step.edge.to]));
    }
    cur = target;
    return true;
  };
  for (const lv of levels) {
    for (;;) {
      const { dist } = dijkstra(cur);
      const candidates = rooms.filter((r) => !visitedRooms.has(r.id) && levelId(scene, r.levelId) === lv.id && dist.has(roomNode.get(r.id)!.id));
      if (!candidates.length) break;
      candidates.sort((a, c) => dist.get(roomNode.get(a.id)!.id)! - dist.get(roomNode.get(c.id)!.id)!);
      const next = candidates[0];
      goTo(roomNode.get(next.id)!.id);
      visitedRooms.add(next.id);
      plan.visited.push(next.name);
    }
    // Then up the stair to the next storey (if any is reachable).
    const nextLevel = levels[levels.findIndex((l) => l.id === lv.id) + 1];
    if (!nextLevel) break;
    const { dist } = dijkstra(cur);
    const ups = nodes.filter((n) => n.level === nextLevel.id && !n.roomId && dist.has(n.id) && (edges.get(n.id) ?? []).some((e) => nodes[e.to].level === lv.id));
    if (!ups.length) break;
    ups.sort((a, c) => dist.get(a.id)! - dist.get(c.id)!);
    goTo(ups[0].id);
  }
  plan.interior = route;
  return plan;
}

/** Length of a polyline. */
export function pathLength(points: Vec3[]): number {
  let L = 0;
  for (let i = 1; i < points.length; i++) L += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y, points[i].z - points[i - 1].z);
  return L;
}

/**
 * Rounds the corners of a polyline with quadratic curves (radius up to `r`,
 * never more than 40% of the adjoining segments) and samples it every `step`
 * metres. Each rounded corner stays inside the triangle of its corner, so the
 * smooth path never strays more than `r` from the straight route.
 */
export function smoothPath(points: Vec3[], r = 0.6, step = 0.05): Vec3[] {
  if (points.length < 3) return points.slice();
  const lerp = (a: Vec3, c: Vec3, t: number): Vec3 => ({ x: a.x + (c.x - a.x) * t, y: a.y + (c.y - a.y) * t, z: a.z + (c.z - a.z) * t });
  const dist = (a: Vec3, c: Vec3) => Math.hypot(a.x - c.x, a.y - c.y, a.z - c.z);
  const out: Vec3[] = [];
  const line = (a: Vec3, c: Vec3) => {
    const n = Math.max(1, Math.ceil(dist(a, c) / step));
    for (let i = out.length ? 1 : 0; i <= n; i++) out.push(lerp(a, c, i / n));
  };
  let start = points[0];
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i - 1];
    const v = points[i];
    const q = points[i + 1];
    const rr = Math.min(r, dist(p, v) * 0.4, dist(v, q) * 0.4);
    const a = lerp(v, p, rr / Math.max(dist(p, v), 1e-9));
    const c = lerp(v, q, rr / Math.max(dist(v, q), 1e-9));
    line(start, a);
    const n = Math.max(2, Math.ceil((2 * rr) / step));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const u = 1 - t;
      out.push({ x: u * u * a.x + 2 * u * t * v.x + t * t * c.x, y: u * u * a.y + 2 * u * t * v.y + t * t * c.y, z: u * u * a.z + 2 * u * t * v.z + t * t * c.z });
    }
    start = c;
  }
  line(start, points[points.length - 1]);
  return out;
}
