/**
 * 2D floor-plan model used by drawing import (raster, PDF, DXF, AI vision).
 * Coordinates are in drawing units (pixels for images, drawing units for DXF);
 * `unitsPerMeter` converts them to meters once calibrated.
 */
import { z } from 'zod';
import type { OperationInput } from '../ops/operations';
import type { Vec2 } from '../schema/elements';
import { pointInPolygon, polygonArea } from '../geometry/math2d';

export const PlanPoint = z.object({ x: z.number(), y: z.number() });
export type PlanPoint = z.infer<typeof PlanPoint>;

export const PlanWall = z.object({
  id: z.string(),
  a: PlanPoint,
  b: PlanPoint,
  /** Thickness in meters (null → default). */
  thickness: z.number().positive().nullable().default(null),
  exterior: z.boolean().default(false),
  /** 0..1, < 0.6 is shown as "needs review". */
  confidence: z.number().min(0).max(1).default(1),
  source: z.enum(['user', 'ai', 'raster', 'dxf']).default('user'),
});
export type PlanWall = z.infer<typeof PlanWall>;

export const PlanOpening = z.object({
  id: z.string(),
  type: z.enum(['door', 'window']),
  wallId: z.string(),
  /** Position along the wall, 0..1. */
  t: z.number().min(0).max(1),
  width: z.number().positive(),
  height: z.number().positive().nullable().default(null),
  sillHeight: z.number().min(0).nullable().default(null),
  confidence: z.number().min(0).max(1).default(1),
  source: z.enum(['user', 'ai', 'raster', 'dxf']).default('user'),
});
export type PlanOpening = z.infer<typeof PlanOpening>;

export const PlanRoom = z.object({
  id: z.string(),
  name: z.string(),
  at: PlanPoint,
  function: z.string().optional(),
  confidence: z.number().min(0).max(1).default(1),
});
export type PlanRoom = z.infer<typeof PlanRoom>;

export const FloorPlan = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
  unitsPerMeter: z.number().positive().nullable().default(null),
  scaleSource: z.enum(['calibration', 'dxf_units', 'ai_dimension', 'assumed', 'none']).default('none'),
  walls: z.array(PlanWall).default([]),
  openings: z.array(PlanOpening).default([]),
  rooms: z.array(PlanRoom).default([]),
  wallHeight: z.number().positive().default(2.7),
  defaultThickness: z.number().positive().default(0.2),
});
export type FloorPlan = z.infer<typeof FloorPlan>;

/** Two-point calibration: user picks two points and enters the real distance. */
export function calibrate(a: PlanPoint, b: PlanPoint, meters: number): number {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(meters > 0) || d <= 0) throw new Error('Calibration needs two distinct points and a positive distance');
  return d / meters;
}

/** Snaps wall endpoints that are within `tol` units of each other to their average. */
export function weldEndpoints(walls: PlanWall[], tol: number): PlanWall[] {
  const pts: { w: number; end: 'a' | 'b'; p: PlanPoint }[] = [];
  walls.forEach((w, i) => {
    pts.push({ w: i, end: 'a', p: w.a }, { w: i, end: 'b', p: w.b });
  });
  const out = walls.map((w) => ({ ...w, a: { ...w.a }, b: { ...w.b } }));
  const used = new Set<number>();
  for (let i = 0; i < pts.length; i++) {
    if (used.has(i)) continue;
    const cluster = [i];
    for (let j = i + 1; j < pts.length; j++) {
      if (used.has(j)) continue;
      if (Math.hypot(pts[i].p.x - pts[j].p.x, pts[i].p.y - pts[j].p.y) <= tol) cluster.push(j);
    }
    if (cluster.length < 2) continue;
    const cx = cluster.reduce((s, k) => s + pts[k].p.x, 0) / cluster.length;
    const cy = cluster.reduce((s, k) => s + pts[k].p.y, 0) / cluster.length;
    for (const k of cluster) {
      used.add(k);
      out[pts[k].w][pts[k].end] = { x: cx, y: cy };
    }
  }
  return out;
}

/**
 * Extends wall endpoints that stop just short of another wall's centre-line
 * (typical when walls were traced from face lines) so T and L joints close.
 */
export function extendToJoints(walls: PlanWall[], tol: number): PlanWall[] {
  const out = walls.map((w) => ({ ...w, a: { ...w.a }, b: { ...w.b } }));
  for (const w of out) {
    for (const end of ['a', 'b'] as const) {
      const p = w[end];
      const other = end === 'a' ? w.b : w.a;
      const dx = p.x - other.x;
      const dy = p.y - other.y;
      const L = Math.hypot(dx, dy) || 1;
      const ux = dx / L;
      const uy = dy / L;
      let best: PlanPoint | null = null;
      let bestD = tol;
      for (const o of out) {
        if (o === w) continue;
        // Intersect ray p + s*u with segment o.a–o.b
        const ex = o.b.x - o.a.x;
        const ey = o.b.y - o.a.y;
        const den = ux * ey - uy * ex;
        if (Math.abs(den) < 1e-9) continue;
        const s = ((o.a.x - p.x) * ey - (o.a.y - p.y) * ex) / den;
        const t = ((o.a.x - p.x) * uy - (o.a.y - p.y) * ux) / den;
        if (s > -tol && s < bestD && t >= -0.01 && t <= 1.01) {
          bestD = Math.abs(s);
          best = { x: p.x + ux * s, y: p.y + uy * s };
        }
      }
      if (best) w[end] = best;
    }
  }
  return out;
}

export interface PlanToSceneOptions {
  levelId: string;
  /** Plan point that maps to the scene origin (defaults to the plan centre). */
  origin?: PlanPoint;
  wallMaterial?: string;
  interiorMaterial?: string;
  floorMaterial?: string;
}

/**
 * Converts a calibrated plan into scene operations: walls (with refs), hosted
 * openings at their measured positions, a floor slab and room zones.
 */
export function planToOperations(plan: FloorPlan, opts: PlanToSceneOptions): { ops: OperationInput[]; warnings: string[] } {
  if (!plan.unitsPerMeter) throw new Error('The drawing scale is not calibrated');
  const k = 1 / plan.unitsPerMeter;
  const o = opts.origin ?? centroidOfWalls(plan) ?? { x: plan.width / 2, y: plan.height / 2 };
  const toM = (p: PlanPoint): Vec2 => ({ x: round3((p.x - o.x) * k), z: round3((p.y - o.y) * k) });
  const ops: OperationInput[] = [];
  const warnings: string[] = [];
  const wallLen = new Map<string, number>();

  plan.walls.forEach((w, i) => {
    const a = toM(w.a);
    const b = toM(w.b);
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 0.1) {
      warnings.push(`Skipped a wall shorter than 10 cm (${w.id})`);
      return;
    }
    wallLen.set(w.id, len);
    ops.push({
      op: 'create',
      ref: `$w${i}`,
      element: {
        type: 'wall',
        name: `${w.exterior ? 'Exterior' : 'Interior'} wall ${i + 1}`,
        levelId: opts.levelId,
        start: a,
        end: b,
        height: plan.wallHeight,
        thickness: w.thickness ?? (w.exterior ? Math.max(plan.defaultThickness, 0.25) : plan.defaultThickness),
        exterior: w.exterior,
        material: w.exterior ? opts.wallMaterial ?? 'plaster_white' : opts.interiorMaterial ?? 'paint_white',
        interiorMaterial: opts.interiorMaterial ?? 'paint_white',
        bim: { importedFrom: w.source, confidence: Math.round(w.confidence * 100) / 100 },
      },
    });
  });

  plan.openings.forEach((op, j) => {
    const idx = plan.walls.findIndex((w) => w.id === op.wallId);
    const len = wallLen.get(op.wallId);
    if (idx < 0 || !len) {
      warnings.push(`Opening ${op.id} is not on a valid wall`);
      return;
    }
    const width = Math.min(op.width, len - 0.1);
    const offset = Math.max(width / 2 + 0.02, Math.min(len - width / 2 - 0.02, op.t * len));
    if (op.type === 'door') {
      ops.push({ op: 'create', element: { type: 'door', name: `Door ${j + 1}`, hostId: `$w${idx}`, offset: round3(offset), width: round3(width), height: Math.min(op.height ?? 2.1, plan.wallHeight - 0.1) } });
    } else {
      const h = Math.min(op.height ?? 1.3, plan.wallHeight - 0.4);
      const sill = Math.min(op.sillHeight ?? 0.9, plan.wallHeight - h - 0.05);
      ops.push({ op: 'create', element: { type: 'window', name: `Window ${j + 1}`, hostId: `$w${idx}`, offset: round3(offset), width: round3(width), height: round3(h), sillHeight: round3(Math.max(0, sill)) } });
    }
  });

  // Floor slab: closed loop of exterior walls if available, else bounding box.
  const loop = closedLoop(plan.walls.filter((w) => w.exterior));
  const pts = plan.walls.flatMap((w) => [w.a, w.b]);
  if (pts.length) {
    let poly: Vec2[];
    if (loop && loop.length >= 3) poly = loop.map(toM);
    else {
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      poly = [
        { x: Math.min(...xs), y: Math.min(...ys) },
        { x: Math.max(...xs), y: Math.min(...ys) },
        { x: Math.max(...xs), y: Math.max(...ys) },
        { x: Math.min(...xs), y: Math.max(...ys) },
      ].map(toM);
      if (plan.walls.some((w) => w.exterior)) warnings.push('Exterior walls do not form a closed loop; the floor slab uses the bounding box.');
    }
    ops.push({ op: 'create', element: { type: 'slab', name: 'Floor', levelId: opts.levelId, polygon: poly, thickness: 0.25, elevation: 0, material: opts.floorMaterial ?? 'oak_floor', role: 'floor' } });
  }

  // Rooms: rectangle bounded by the nearest walls around each label (rectilinear plans).
  for (const r of plan.rooms) {
    const rect = enclosingRect(r.at, plan.walls);
    if (!rect) {
      warnings.push(`Could not find walls enclosing room "${r.name}"`);
      continue;
    }
    const poly = rect.map(toM);
    if (Math.abs(polygonArea(poly)) < 1) continue;
    const fn = guessFunction(r.function ?? r.name);
    ops.push({ op: 'create', element: { type: 'room', name: r.name, levelId: opts.levelId, polygon: poly, function: fn } });
  }
  return { ops, warnings };
}

function round3(v: number) {
  return Math.round(v * 1000) / 1000;
}

function centroidOfWalls(plan: FloorPlan): PlanPoint | null {
  const pts = plan.walls.flatMap((w) => [w.a, w.b]);
  if (!pts.length) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}

/** Follows connected wall endpoints to find a closed polygon. */
export function closedLoop(walls: PlanWall[], tol = 1e-3): PlanPoint[] | null {
  if (walls.length < 3) return null;
  const key = (p: PlanPoint) => `${Math.round(p.x / Math.max(tol, 1e-6))},${Math.round(p.y / Math.max(tol, 1e-6))}`;
  const adj = new Map<string, { p: PlanPoint; next: PlanPoint; w: number }[]>();
  walls.forEach((w, i) => {
    adj.set(key(w.a), [...(adj.get(key(w.a)) ?? []), { p: w.a, next: w.b, w: i }]);
    adj.set(key(w.b), [...(adj.get(key(w.b)) ?? []), { p: w.b, next: w.a, w: i }]);
  });
  const start = walls[0].a;
  const loop: PlanPoint[] = [start];
  const usedWalls = new Set<number>();
  let cur = start;
  for (let guard = 0; guard < walls.length + 1; guard++) {
    const options = (adj.get(key(cur)) ?? []).filter((e) => !usedWalls.has(e.w));
    if (!options.length) return null;
    const e = options[0];
    usedWalls.add(e.w);
    cur = e.next;
    if (key(cur) === key(start)) return loop;
    loop.push(cur);
  }
  return null;
}

function enclosingRect(p: PlanPoint, walls: PlanWall[]): PlanPoint[] | null {
  const hit = (dx: number, dy: number) => {
    let best = Infinity;
    for (const w of walls) {
      const ex = w.b.x - w.a.x;
      const ey = w.b.y - w.a.y;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      const s = ((w.a.x - p.x) * ey - (w.a.y - p.y) * ex) / den;
      const t = ((w.a.x - p.x) * dy - (w.a.y - p.y) * dx) / den;
      if (s > 0 && t >= 0 && t <= 1 && s < best) best = s;
    }
    return best;
  };
  const l = hit(-1, 0);
  const r = hit(1, 0);
  const u = hit(0, -1);
  const d = hit(0, 1);
  if (![l, r, u, d].every(Number.isFinite)) return null;
  const rect = [
    { x: p.x - l, y: p.y - u },
    { x: p.x + r, y: p.y - u },
    { x: p.x + r, y: p.y + d },
    { x: p.x - l, y: p.y + d },
  ];
  return pointInPolygon({ x: p.x, z: p.y }, rect.map((q) => ({ x: q.x, z: q.y }))) ? rect : null;
}

export function guessFunction(text: string): 'living' | 'kitchen' | 'dining' | 'bedroom' | 'bathroom' | 'office' | 'hall' | 'storage' | 'garage' | 'terrace' | 'other' {
  const t = text.toLowerCase();
  if (/living|vardagsrum|lounge|allrum/.test(t)) return 'living';
  if (/kitchen|kök|kok/.test(t)) return 'kitchen';
  if (/dining|matsal|matrum/.test(t)) return 'dining';
  if (/bed|sovrum|sov/.test(t)) return 'bedroom';
  if (/bath|wc|toilet|badrum|bad|dusch/.test(t)) return 'bathroom';
  if (/office|study|kontor|arbetsrum/.test(t)) return 'office';
  if (/hall|entr|corridor|korridor|hall/.test(t)) return 'hall';
  if (/storage|förråd|klk|closet|wardrobe/.test(t)) return 'storage';
  if (/garage/.test(t)) return 'garage';
  if (/terrace|terrass|balcony|balkong|altan/.test(t)) return 'terrace';
  return 'other';
}
