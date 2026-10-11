/**
 * Wall recognition without AI.
 *
 * - Raster: finds thick, straight dark bands (poché walls) in a greyscale
 *   image, merges them into centre-lines, closes joints and turns gaps between
 *   collinear walls into door/window openings.
 * - Vector (DXF): pairs parallel face lines into wall centre-lines + thickness.
 * Results carry confidence values and are meant to be reviewed by the user.
 */
import type { FloorPlan, PlanOpening, PlanPoint, PlanWall } from './plan';
import { extendToJoints, weldEndpoints } from './plan';

let counter = 0;
const nid = (p: string) => `${p}${++counter}`;

interface Band {
  start: number; // along-axis start
  end: number;
  c0: number; // cross-axis first row
  c1: number; // cross-axis last row
  starts: number[];
  ends: number[];
}

export interface RasterDetectOptions {
  /** Pixels darker than this are ink. Default: automatic (Otsu). */
  threshold?: number;
  minRunFraction?: number;
  minThickness?: number;
  maxThicknessFraction?: number;
}

export interface RasterDetectResult {
  walls: PlanWall[];
  openings: PlanOpening[];
  medianThicknessPx: number;
  threshold: number;
}

export function otsu(gray: Uint8Array | Uint8ClampedArray): number {
  const hist = new Array(256).fill(0);
  for (const v of gray) hist[v]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      thr = t;
    }
  }
  return Math.min(thr, 160);
}

function scanBands(isDark: (along: number, cross: number) => boolean, alongLen: number, crossLen: number, minRun: number): Band[] {
  const done: Band[] = [];
  let active: Band[] = [];
  for (let c = 0; c < crossLen; c++) {
    const runs: [number, number][] = [];
    let s = -1;
    for (let a = 0; a <= alongLen; a++) {
      const d = a < alongLen && isDark(a, c);
      if (d && s < 0) s = a;
      if (!d && s >= 0) {
        if (a - s >= minRun) runs.push([s, a - 1]);
        s = -1;
      }
    }
    const next: Band[] = [];
    const used = new Set<Band>();
    for (const [rs, re] of runs) {
      let match: Band | undefined;
      for (const b of active) {
        if (used.has(b)) continue;
        const ov = Math.min(re, b.end) - Math.max(rs, b.start);
        if (ov >= 0.7 * Math.min(re - rs, b.end - b.start)) {
          match = b;
          break;
        }
      }
      if (match) {
        used.add(match);
        match.c1 = c;
        match.starts.push(rs);
        match.ends.push(re);
        match.start = Math.min(match.start, rs);
        match.end = Math.max(match.end, re);
        next.push(match);
      } else next.push({ start: rs, end: re, c0: c, c1: c, starts: [rs], ends: [re] });
    }
    for (const b of active) if (!used.has(b)) done.push(b);
    active = next;
  }
  return [...done, ...active];
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/** Detects walls in a greyscale raster (row-major, 1 byte per pixel). */
export function detectWallsFromRaster(gray: Uint8Array | Uint8ClampedArray, width: number, height: number, opts: RasterDetectOptions = {}): RasterDetectResult {
  const thr = opts.threshold ?? otsu(gray);
  const size = Math.max(width, height);
  const minRun = Math.max(12, Math.round(size * (opts.minRunFraction ?? 0.03)));
  const minT = opts.minThickness ?? 3;
  const maxT = Math.max(minT + 2, Math.round(size * (opts.maxThicknessFraction ?? 0.04)));
  const dark = (x: number, y: number) => gray[y * width + x] <= thr;

  type Seg = { horizontal: boolean; c: number; a0: number; a1: number; t: number };
  const segs: Seg[] = [];
  const collect = (bands: Band[], horizontal: boolean) => {
    for (const b of bands) {
      const t = b.c1 - b.c0 + 1;
      if (t < minT || t > maxT) continue;
      const a0 = median(b.starts);
      const a1 = median(b.ends);
      if (a1 - a0 < minRun || a1 - a0 < t * 4) continue;
      segs.push({ horizontal, c: (b.c0 + b.c1) / 2, a0, a1, t });
    }
  };
  collect(scanBands((a, c) => dark(a, c), width, height, minRun), true);
  collect(scanBands((a, c) => dark(c, a), height, width, minRun), false);

  const thickness = median(segs.map((s) => s.t)) || minT;
  // Merge collinear segments and turn small gaps into openings.
  const merged: (Seg & { gaps: [number, number][] })[] = [];
  const sorted = [...segs].sort((p, q) => Number(p.horizontal) - Number(q.horizontal) || p.c - q.c || p.a0 - q.a0);
  for (const s of sorted) {
    const m = merged.find((x) => x.horizontal === s.horizontal && Math.abs(x.c - s.c) <= Math.max(x.t, s.t) * 0.6 && s.a0 <= x.a1 + size * 0.12 && s.a1 >= x.a0 - size * 0.12);
    if (m) {
      const lo = Math.min(m.a0, s.a0);
      const hi = Math.max(m.a1, s.a1);
      if (s.a0 > m.a1 + 1) m.gaps.push([m.a1, s.a0]);
      else if (m.a0 > s.a1 + 1) m.gaps.push([s.a1, m.a0]);
      m.c = (m.c * (m.a1 - m.a0) + s.c * (s.a1 - s.a0)) / (m.a1 - m.a0 + s.a1 - s.a0);
      m.a0 = lo;
      m.a1 = hi;
      m.t = Math.max(m.t, s.t);
    } else merged.push({ ...s, gaps: [] });
  }

  const walls: PlanWall[] = [];
  const openings: PlanOpening[] = [];
  for (const m of merged) {
    const id = nid('rw');
    const a: PlanPoint = m.horizontal ? { x: m.a0, y: m.c } : { x: m.c, y: m.a0 };
    const b: PlanPoint = m.horizontal ? { x: m.a1, y: m.c } : { x: m.c, y: m.a1 };
    const thickRatio = m.t / thickness;
    walls.push({ id, a, b, thickness: null, exterior: thickRatio > 1.25, confidence: Math.max(0.35, Math.min(0.85, 0.85 - Math.abs(1 - thickRatio) * 0.3)), source: 'raster' });
    const L = m.a1 - m.a0;
    for (const [g0, g1] of m.gaps) {
      const gw = g1 - g0;
      if (gw < thickness * 1.5) continue;
      // Thin lines across the gap (glazing symbol) → window, otherwise door.
      let ink = 0;
      let n = 0;
      for (let s = g0 + 1; s < g1; s++) {
        for (const off of [-m.t / 3, 0, m.t / 3]) {
          const x = Math.round(m.horizontal ? s : m.c + off);
          const y = Math.round(m.horizontal ? m.c + off : s);
          if (x >= 0 && y >= 0 && x < width && y < height) {
            n++;
            if (dark(x, y)) ink++;
          }
        }
      }
      const type = n && ink / n > 0.25 ? 'window' : 'door';
      openings.push({ id: nid('ro'), type, wallId: id, t: (g0 + gw / 2 - m.a0) / L, width: gw, height: null, sillHeight: null, confidence: 0.5, source: 'raster' });
    }
  }
  // Snap joints: extend to perpendicular centre-lines and weld coincident ends.
  const closed = weldEndpoints(extendToJoints(walls, thickness * 1.6), thickness * 0.8);
  return { walls: closed, openings, medianThicknessPx: thickness, threshold: thr };
}

/** Opening widths are stored in plan units by the detector; convert to meters. */
export function openingWidthsToMeters(openings: PlanOpening[], unitsPerMeter: number): PlanOpening[] {
  return openings.map((o) => (o.source === 'raster' || o.source === 'ai' ? { ...o, width: Math.max(0.5, Math.min(4, o.width / unitsPerMeter)) } : o));
}

export interface Segment {
  a: PlanPoint;
  b: PlanPoint;
  layer?: string;
}

/**
 * Vector walls: pairs of parallel, overlapping lines between `minT` and `maxT`
 * apart (meters × unitsPerMeter) become one centre-line wall.
 */
export function detectWallsFromSegments(segments: Segment[], unitsPerMeter: number, opts: { minT?: number; maxT?: number } = {}): PlanWall[] {
  const minT = (opts.minT ?? 0.06) * unitsPerMeter;
  const maxT = (opts.maxT ?? 0.6) * unitsPerMeter;
  const minLen = 0.3 * unitsPerMeter;
  const segs = segments.filter((s) => Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) >= minLen);
  const used = new Set<number>();
  const walls: PlanWall[] = [];
  for (let i = 0; i < segs.length; i++) {
    if (used.has(i)) continue;
    const s = segs[i];
    const dx = s.b.x - s.a.x;
    const dy = s.b.y - s.a.y;
    const L = Math.hypot(dx, dy);
    const ux = dx / L;
    const uy = dy / L;
    let best: { j: number; d: number; lo: number; hi: number } | null = null;
    for (let j = 0; j < segs.length; j++) {
      if (j === i || used.has(j)) continue;
      const o = segs[j];
      const ox = o.b.x - o.a.x;
      const oy = o.b.y - o.a.y;
      const OL = Math.hypot(ox, oy);
      if (Math.abs((ux * oy - uy * ox) / OL) > 0.02) continue; // not parallel
      const d = Math.abs((o.a.x - s.a.x) * -uy + (o.a.y - s.a.y) * ux);
      if (d < minT || d > maxT) continue;
      const p0 = (o.a.x - s.a.x) * ux + (o.a.y - s.a.y) * uy;
      const p1 = (o.b.x - s.a.x) * ux + (o.b.y - s.a.y) * uy;
      const lo = Math.max(0, Math.min(p0, p1));
      const hi = Math.min(L, Math.max(p0, p1));
      if (hi - lo < 0.5 * Math.min(L, OL)) continue;
      if (!best || d < best.d) best = { j, d, lo, hi };
    }
    if (!best) continue;
    used.add(i);
    used.add(best.j);
    const o = segs[best.j];
    const side = Math.sign((o.a.x - s.a.x) * -uy + (o.a.y - s.a.y) * ux) || 1;
    const nx = -uy * side * (best.d / 2);
    const ny = ux * side * (best.d / 2);
    walls.push({
      id: nid('dw'),
      a: { x: s.a.x + ux * best.lo + nx, y: s.a.y + uy * best.lo + ny },
      b: { x: s.a.x + ux * best.hi + nx, y: s.a.y + uy * best.hi + ny },
      thickness: Math.round((best.d / unitsPerMeter) * 1000) / 1000,
      exterior: best.d / unitsPerMeter >= 0.25,
      confidence: 0.8,
      source: 'dxf',
    });
  }
  const tol = 0.4 * unitsPerMeter;
  return weldEndpoints(extendToJoints(walls, tol), 0.05 * unitsPerMeter);
}

/** Converts an AI vision analysis into an editable plan (with uncertainty preserved). */
export function analysisToPlan(
  a: {
    imageWidth: number;
    imageHeight: number;
    scale?: { pixelsPerMeter?: number | null; source?: string; confidence?: number };
    walls: { x1: number; y1: number; x2: number; y2: number; thicknessPx?: number | null; exterior?: boolean; confidence?: number }[];
    openings: { type: 'door' | 'window' | 'opening'; x: number; y: number; widthPx: number; confidence?: number }[];
    rooms: { name: string; x: number; y: number; function?: string }[];
    dimensions: { x1: number; y1: number; x2: number; y2: number; valueMeters: number }[];
  },
  base?: Partial<FloorPlan>,
): { plan: FloorPlan; suggestedUnitsPerMeter: number | null; scaleConfidence: number } {
  const walls: PlanWall[] = a.walls.map((w) => ({ id: nid('aw'), a: { x: w.x1, y: w.y1 }, b: { x: w.x2, y: w.y2 }, thickness: null, exterior: !!w.exterior, confidence: w.confidence ?? 0.5, source: 'ai' as const }));
  const openings: PlanOpening[] = [];
  for (const o of a.openings) {
    let best: { w: PlanWall; t: number; d: number } | null = null;
    for (const w of walls) {
      const ex = w.b.x - w.a.x;
      const ey = w.b.y - w.a.y;
      const l2 = ex * ex + ey * ey;
      if (!l2) continue;
      const t = Math.max(0, Math.min(1, ((o.x - w.a.x) * ex + (o.y - w.a.y) * ey) / l2));
      const d = Math.hypot(w.a.x + ex * t - o.x, w.a.y + ey * t - o.y);
      if (!best || d < best.d) best = { w, t, d };
    }
    if (best && best.d < Math.max(a.imageWidth, a.imageHeight) * 0.03) {
      openings.push({ id: nid('ao'), type: o.type === 'window' ? 'window' : 'door', wallId: best.w.id, t: best.t, width: o.widthPx, height: null, sillHeight: null, confidence: o.confidence ?? 0.5, source: 'ai' });
    }
  }
  // Scale suggestion from readable dimension strings (median of estimates).
  const est = a.dimensions.map((d) => Math.hypot(d.x2 - d.x1, d.y2 - d.y1) / d.valueMeters).filter((v) => Number.isFinite(v) && v > 0);
  const fromDims = est.length ? median(est) : null;
  const spread = est.length > 1 ? Math.max(...est.map((v) => Math.abs(v - fromDims!) / fromDims!)) : 0.5;
  const suggested = fromDims ?? a.scale?.pixelsPerMeter ?? null;
  const conf = fromDims ? Math.max(0.2, Math.min(0.95, 0.9 - spread)) : (a.scale?.confidence ?? 0);
  return {
    plan: {
      width: a.imageWidth,
      height: a.imageHeight,
      unitsPerMeter: null,
      scaleSource: 'none',
      walls: weldEndpoints(walls, Math.max(a.imageWidth, a.imageHeight) * 0.01),
      openings,
      rooms: a.rooms.map((r) => ({ id: nid('ar'), name: r.name, at: { x: r.x, y: r.y }, function: r.function, confidence: 0.6 })),
      wallHeight: base?.wallHeight ?? 2.7,
      defaultThickness: base?.defaultThickness ?? 0.2,
    },
    suggestedUnitsPerMeter: suggested,
    scaleConfidence: conf,
  };
}
