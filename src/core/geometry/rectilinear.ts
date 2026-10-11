/**
 * Rectilinear cell decomposition.
 *
 * Axis-aligned labelled rectangles (building blocks, rooms) are rasterised on
 * the irregular grid formed by all of their edges. From that grid we derive:
 * - wall segments between differently-labelled cells (interior partitions)
 * - wall segments between labelled and empty cells (exterior envelope)
 * - outline polygons of any subset of cells (slabs, room zones)
 * All results are exact and deterministic.
 */
import type { Vec2 } from '../schema/elements';

export interface LabeledRect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  label: string;
}

export interface CellGrid {
  xs: number[];
  zs: number[];
  /** cells[i][j] = label of cell spanning xs[i]..xs[i+1], zs[j]..zs[j+1] */
  cells: (string | null)[][];
}

const KEY_DIGITS = 6;
const q = (v: number) => Math.round(v * 10 ** KEY_DIGITS) / 10 ** KEY_DIGITS;

function uniqueSorted(values: number[]): number[] {
  const s = [...new Set(values.map(q))].sort((a, b) => a - b);
  return s;
}

/** Later rectangles take priority over earlier ones. */
export function buildGrid(rects: LabeledRect[]): CellGrid {
  const xs = uniqueSorted(rects.flatMap((r) => [Math.min(r.x0, r.x1), Math.max(r.x0, r.x1)]));
  const zs = uniqueSorted(rects.flatMap((r) => [Math.min(r.z0, r.z1), Math.max(r.z0, r.z1)]));
  const cells: (string | null)[][] = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const col: (string | null)[] = [];
    const cx = (xs[i] + xs[i + 1]) / 2;
    for (let j = 0; j < zs.length - 1; j++) {
      const cz = (zs[j] + zs[j + 1]) / 2;
      let label: string | null = null;
      for (const r of rects) {
        if (cx > Math.min(r.x0, r.x1) && cx < Math.max(r.x0, r.x1) && cz > Math.min(r.z0, r.z1) && cz < Math.max(r.z0, r.z1)) {
          label = r.label;
        }
      }
      col.push(label);
    }
    cells.push(col);
  }
  return { xs, zs, cells };
}

export interface EdgeSegment {
  a: Vec2;
  b: Vec2;
  kind: 'exterior' | 'interior';
  /** Label on the "negative" side (smaller x for vertical lines, smaller z for horizontal). */
  neg: string | null;
  pos: string | null;
  /** Outward normal for exterior edges. */
  outward?: Vec2;
}

/**
 * Extracts boundary segments. `sameGroup(a, b)` returning true suppresses an
 * interior wall between two labels (e.g. open-plan living + kitchen).
 */
export function extractEdges(grid: CellGrid, sameGroup: (a: string, b: string) => boolean = (a, b) => a === b): EdgeSegment[] {
  const { xs, zs, cells } = grid;
  const nx = xs.length - 1;
  const nz = zs.length - 1;
  const at = (i: number, j: number) => (i >= 0 && i < nx && j >= 0 && j < nz ? cells[i][j] : null);
  const out: EdgeSegment[] = [];

  const classify = (neg: string | null, pos: string | null): EdgeSegment['kind'] | null => {
    if (neg === null && pos === null) return null;
    if (neg === null || pos === null) return 'exterior';
    if (neg === pos || sameGroup(neg, pos)) return null;
    return 'interior';
  };

  // Vertical lines x = xs[i]
  for (let i = 0; i <= nx; i++) {
    let run: EdgeSegment | null = null;
    for (let j = 0; j < nz; j++) {
      const neg = at(i - 1, j);
      const pos = at(i, j);
      const kind = classify(neg, pos);
      const sameRun = run && kind && run.kind === kind && run.neg === neg && run.pos === pos;
      if (sameRun) {
        run!.b = { x: xs[i], z: zs[j + 1] };
        continue;
      }
      if (run) out.push(run);
      run = kind
        ? {
            a: { x: xs[i], z: zs[j] },
            b: { x: xs[i], z: zs[j + 1] },
            kind,
            neg,
            pos,
            outward: kind === 'exterior' ? { x: neg === null ? -1 : 1, z: 0 } : undefined,
          }
        : null;
    }
    if (run) out.push(run);
  }
  // Horizontal lines z = zs[j]
  for (let j = 0; j <= nz; j++) {
    let run: EdgeSegment | null = null;
    for (let i = 0; i < nx; i++) {
      const neg = at(i, j - 1);
      const pos = at(i, j);
      const kind = classify(neg, pos);
      const sameRun = run && kind && run.kind === kind && run.neg === neg && run.pos === pos;
      if (sameRun) {
        run!.b = { x: xs[i + 1], z: zs[j] };
        continue;
      }
      if (run) out.push(run);
      run = kind
        ? {
            a: { x: xs[i], z: zs[j] },
            b: { x: xs[i + 1], z: zs[j] },
            kind,
            neg,
            pos,
            outward: kind === 'exterior' ? { x: 0, z: neg === null ? -1 : 1 } : undefined,
          }
        : null;
    }
    if (run) out.push(run);
  }
  return out;
}

/** Merges collinear, touching exterior segments regardless of labels. */
export function mergeCollinear(segs: EdgeSegment[]): EdgeSegment[] {
  const out: EdgeSegment[] = [];
  const sorted = [...segs].sort((s, t) => {
    const sv = s.a.x === s.b.x;
    const tv = t.a.x === t.b.x;
    if (sv !== tv) return sv ? -1 : 1;
    if (sv) return s.a.x - t.a.x || s.a.z - t.a.z;
    return s.a.z - t.a.z || s.a.x - t.a.x;
  });
  for (const s of sorted) {
    const last = out[out.length - 1];
    const vertical = s.a.x === s.b.x;
    if (
      last &&
      last.kind === s.kind &&
      s.kind === 'exterior' &&
      (last.a.x === last.b.x) === vertical &&
      last.outward?.x === s.outward?.x &&
      last.outward?.z === s.outward?.z &&
      (vertical ? last.a.x === s.a.x && q(last.b.z) === q(s.a.z) : last.a.z === s.a.z && q(last.b.x) === q(s.a.x))
    ) {
      last.b = { ...s.b };
      continue;
    }
    out.push({ ...s, a: { ...s.a }, b: { ...s.b } });
  }
  return out;
}

/**
 * Outline loops of all cells for which `include(label)` is true. Loops are
 * returned counter-clockwise in the (x, z) plane for outer boundaries.
 */
export function outlineLoops(grid: CellGrid, include: (label: string | null) => boolean): Vec2[][] {
  const { xs, zs, cells } = grid;
  const nx = xs.length - 1;
  const nz = zs.length - 1;
  const inside = (i: number, j: number) => i >= 0 && i < nx && j >= 0 && j < nz && include(cells[i][j]);
  // Directed boundary edges keyed by start point; cell interior on the left.
  const edges = new Map<string, Vec2[]>();
  const key = (p: Vec2) => `${q(p.x)},${q(p.z)}`;
  const addEdge = (a: Vec2, b: Vec2) => {
    const k = key(a);
    const list = edges.get(k) ?? [];
    list.push(b);
    edges.set(k, list);
  };
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      if (!inside(i, j)) continue;
      const x0 = xs[i];
      const x1 = xs[i + 1];
      const z0 = zs[j];
      const z1 = zs[j + 1];
      if (!inside(i, j - 1)) addEdge({ x: x1, z: z0 }, { x: x0, z: z0 });
      if (!inside(i - 1, j)) addEdge({ x: x0, z: z0 }, { x: x0, z: z1 });
      if (!inside(i, j + 1)) addEdge({ x: x0, z: z1 }, { x: x1, z: z1 });
      if (!inside(i + 1, j)) addEdge({ x: x1, z: z1 }, { x: x1, z: z0 });
    }
  }
  const loops: Vec2[][] = [];
  while (edges.size) {
    const [startKey, list] = edges.entries().next().value as [string, Vec2[]];
    const [sx, sz] = startKey.split(',').map(Number);
    const loop: Vec2[] = [{ x: sx, z: sz }];
    let next = list.pop()!;
    if (!list.length) edges.delete(startKey);
    let guard = 0;
    while (key(next) !== startKey && guard++ < 100000) {
      loop.push(next);
      const k = key(next);
      const l = edges.get(k);
      if (!l || !l.length) break;
      const n = l.pop()!;
      if (!l.length) edges.delete(k);
      next = n;
    }
    loops.push(simplifyLoop(loop));
  }
  return loops;
}

/** Removes collinear vertices. */
export function simplifyLoop(loop: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const p = loop[(i - 1 + n) % n];
    const c = loop[i];
    const nx = loop[(i + 1) % n];
    const cross = (c.x - p.x) * (nx.z - c.z) - (c.z - p.z) * (nx.x - c.x);
    if (Math.abs(cross) > 1e-9) out.push(c);
  }
  return out;
}
