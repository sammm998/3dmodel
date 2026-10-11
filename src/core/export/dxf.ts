/**
 * DXF (AutoCAD R12 ASCII) floor-plan export.
 *
 * Produces a dimensioned 2D plan per level: wall outlines broken at openings,
 * window and door symbols (with door swing arcs), room names and areas,
 * furniture footprints and overall wall dimensions. Levels are placed side by
 * side along +X. Units: meters (plan X = x, plan Y = -z, north up).
 */
import type { Element, Vec2, WallElement } from '../schema/elements';
import type { Scene } from '../schema/scene';
import { computeWallExtensions, findElement, sceneBounds, wallFrame } from '../scene/query';
import { add2, polygonArea, polygonCentroid, round, scale2 } from '../geometry/math2d';

type P = { x: number; y: number };

class DxfWriter {
  out: string[] = [];
  pair(code: number, value: string | number) {
    this.out.push(String(code), typeof value === 'number' ? String(round(value, 6)) : value);
  }
  line(layer: string, a: P, b: P) {
    this.pair(0, 'LINE');
    this.pair(8, layer);
    this.pair(10, a.x);
    this.pair(20, a.y);
    this.pair(30, 0);
    this.pair(11, b.x);
    this.pair(21, b.y);
    this.pair(31, 0);
  }
  poly(layer: string, pts: P[], closed = true) {
    for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) this.line(layer, pts[i], pts[(i + 1) % pts.length]);
  }
  arc(layer: string, c: P, r: number, startDeg: number, endDeg: number) {
    this.pair(0, 'ARC');
    this.pair(8, layer);
    this.pair(10, c.x);
    this.pair(20, c.y);
    this.pair(30, 0);
    this.pair(40, r);
    this.pair(50, startDeg);
    this.pair(51, endDeg);
  }
  text(layer: string, p: P, h: number, s: string, centered = true) {
    this.pair(0, 'TEXT');
    this.pair(8, layer);
    this.pair(10, p.x);
    this.pair(20, p.y);
    this.pair(30, 0);
    this.pair(40, h);
    this.pair(1, s.replace(/[^\x20-\x7e]/g, (ch) => ({ å: 'a', ä: 'a', ö: 'o', Å: 'A', Ä: 'A', Ö: 'O', '·': '-', '×': 'x', '²': '2' })[ch] ?? '?'));
    if (centered) {
      this.pair(72, 1);
      this.pair(11, p.x);
      this.pair(21, p.y);
      this.pair(31, 0);
    }
  }
}

const LAYERS: [string, number][] = [
  ['WALLS', 7],
  ['WINDOWS', 4],
  ['DOORS', 3],
  ['ROOMS', 8],
  ['FURNITURE', 9],
  ['DIMENSIONS', 1],
  ['ANNOTATION', 2],
  ['SITE', 82],
];

export function exportDXF(scene: Scene, opts: { levelIds?: string[] } = {}): string {
  const d = new DxfWriter();
  d.pair(0, 'SECTION');
  d.pair(2, 'HEADER');
  d.pair(9, '$ACADVER');
  d.pair(1, 'AC1009');
  d.pair(9, '$INSUNITS');
  d.pair(70, 6);
  d.pair(0, 'ENDSEC');
  d.pair(0, 'SECTION');
  d.pair(2, 'TABLES');
  d.pair(0, 'TABLE');
  d.pair(2, 'LAYER');
  d.pair(70, LAYERS.length);
  for (const [name, color] of LAYERS) {
    d.pair(0, 'LAYER');
    d.pair(2, name);
    d.pair(70, 0);
    d.pair(62, color);
    d.pair(6, 'CONTINUOUS');
  }
  d.pair(0, 'ENDTAB');
  d.pair(0, 'ENDSEC');
  d.pair(0, 'SECTION');
  d.pair(2, 'ENTITIES');

  const b = sceneBounds(scene);
  const spanX = b ? b.max.x - b.min.x + 8 : 20;
  const levels = scene.levels.filter((l) => !opts.levelIds || opts.levelIds.includes(l.id));
  const walls = scene.elements.filter((e): e is WallElement => e.type === 'wall');
  const ext = computeWallExtensions(walls);

  levels.forEach((lvl, li) => {
    const dx = li * spanX;
    const T = (p: Vec2): P => ({ x: p.x + dx, y: -p.z });
    const onLevel = (e: Element) => (e.levelId ?? scene.levels[0].id) === lvl.id;
    if (b) d.text('ANNOTATION', { x: (b.min.x + b.max.x) / 2 + dx, y: -b.max.z - 2 }, 0.5, lvl.name.toUpperCase());

    for (const w of walls.filter(onLevel)) {
      const f = wallFrame(w);
      const e = ext.get(w.id) ?? { start: 0, end: 0 };
      const ht = w.thickness / 2;
      const at = (u: number, side: number) => T(add2(add2(w.start, scale2(f.dir, u)), scale2(f.normal, side * ht)));
      const openings = scene.elements
        .filter((o) => (o.type === 'window' || o.type === 'door') && o.hostId === w.id)
        .map((o) => ({ el: o, a: o.type === 'window' || o.type === 'door' ? o.offset - o.width / 2 : 0, b: o.type === 'window' || o.type === 'door' ? o.offset + o.width / 2 : 0 }))
        .sort((p, q) => p.a - q.a);
      // Wall faces broken at openings.
      let cur = -e.start;
      const segs: [number, number][] = [];
      for (const o of openings) {
        if (o.a > cur) segs.push([cur, o.a]);
        cur = Math.max(cur, o.b);
      }
      if (f.length + e.end > cur) segs.push([cur, f.length + e.end]);
      for (const [a, bb] of segs) {
        d.line('WALLS', at(a, 1), at(bb, 1));
        d.line('WALLS', at(a, -1), at(bb, -1));
      }
      d.line('WALLS', at(-e.start, 1), at(-e.start, -1));
      d.line('WALLS', at(f.length + e.end, 1), at(f.length + e.end, -1));
      for (const o of openings) {
        d.line('WALLS', at(o.a, 1), at(o.a, -1));
        d.line('WALLS', at(o.b, 1), at(o.b, -1));
        if (o.el.type === 'window') {
          d.line('WINDOWS', at(o.a, 0.3), at(o.b, 0.3));
          d.line('WINDOWS', at(o.a, -0.3), at(o.b, -0.3));
          d.line('WINDOWS', at(o.a, 0), at(o.b, 0));
        } else if (o.el.type === 'door') {
          const width = o.b - o.a;
          if (o.el.doorType === 'hinged') {
            const hingeU = o.el.swing === 'left' ? o.a : o.b;
            const hinge = at(hingeU, 1);
            const leafEnd = T(add2(add2(add2(w.start, scale2(f.dir, hingeU)), scale2(f.normal, ht)), scale2(f.normal, width)));
            d.line('DOORS', hinge, leafEnd);
            const angWall = (Math.atan2(-(f.dir.z), f.dir.x) * 180) / Math.PI;
            const angNorm = (Math.atan2(-(f.normal.z), f.normal.x) * 180) / Math.PI;
            const toward = o.el.swing === 'left' ? angWall : angWall + 180;
            const [s, en] = normArc(toward, angNorm);
            d.arc('DOORS', hinge, width, s, en);
          } else {
            d.line('DOORS', at(o.a, 0.15), at(o.b, 0.15));
            d.line('DOORS', at(o.a, -0.15), at(o.b, -0.15));
          }
        }
      }
    }
    // Overall dimensions of exterior walls.
    for (const w of walls.filter((x) => onLevel(x) && x.exterior)) {
      const f = wallFrame(w);
      const ox = Number(w.bim?.outwardX ?? f.normal.x);
      const oz = Number(w.bim?.outwardZ ?? f.normal.z);
      const off = { x: ox * 1.0, z: oz * 1.0 };
      const a = T(add2(w.start, off));
      const bb = T(add2(w.end, off));
      d.line('DIMENSIONS', a, bb);
      d.line('DIMENSIONS', T(add2(w.start, scale2(off, 0.6))), T(add2(w.start, scale2(off, 1.15))));
      d.line('DIMENSIONS', T(add2(w.end, scale2(off, 0.6))), T(add2(w.end, scale2(off, 1.15))));
      const mid = T(add2(scale2(add2(w.start, w.end), 0.5), scale2(off, 1.35)));
      d.text('DIMENSIONS', mid, 0.22, `${f.length.toFixed(2)}`);
    }
    for (const r of scene.elements.filter((e) => e.type === 'room' && onLevel(e))) {
      if (r.type !== 'room') continue;
      d.poly('ROOMS', r.polygon.map(T));
      const c = T(polygonCentroid(r.polygon));
      d.text('ROOMS', c, 0.25, r.name);
      d.text('ROOMS', { x: c.x, y: c.y - 0.4 }, 0.18, `${Math.abs(polygonArea(r.polygon)).toFixed(1)} m2`);
    }
    for (const fEl of scene.elements.filter((e) => e.type === 'furniture' && onLevel(e))) {
      if (fEl.type !== 'furniture') continue;
      const c = Math.cos(fEl.rotation);
      const s = Math.sin(fEl.rotation);
      const hw = fEl.width / 2;
      const hd = fEl.depth / 2;
      const pts = [
        [-hw, -hd],
        [hw, -hd],
        [hw, hd],
        [-hw, hd],
      ].map(([x, z]) => T({ x: fEl.position.x + x * c + z * s, z: fEl.position.z - x * s + z * c }));
      d.poly('FURNITURE', pts);
    }
    for (const st of scene.elements.filter((e) => e.type === 'stair' && onLevel(e))) {
      if (st.type !== 'stair') continue;
      const c = Math.cos(st.rotation);
      const s = Math.sin(st.rotation);
      const go = st.totalRun / st.steps;
      const P2 = (x: number, z: number) => T({ x: st.position.x + x * c + z * s, z: st.position.z - x * s + z * c });
      for (let i = 0; i <= st.steps; i++) d.line('ANNOTATION', P2(-st.width / 2, -i * go), P2(st.width / 2, -i * go));
      d.line('ANNOTATION', P2(0, 0), P2(0, -st.totalRun));
    }
    if (li === 0) {
      for (const p of scene.elements.filter((e) => e.type === 'pool')) {
        if (p.type !== 'pool') continue;
        const hw = p.width / 2;
        const hl = p.length / 2;
        const c = Math.cos(p.rotation);
        const s = Math.sin(p.rotation);
        d.poly(
          'SITE',
          [
            [-hw, -hl],
            [hw, -hl],
            [hw, hl],
            [-hw, hl],
          ].map(([x, z]) => T({ x: p.center.x + x * c + z * s, z: p.center.z - x * s + z * c })),
        );
      }
    }
  });
  void findElement;
  d.pair(0, 'ENDSEC');
  d.pair(0, 'EOF');
  return d.out.join('\n') + '\n';
}

function normArc(a: number, b: number): [number, number] {
  // Returns the 90° arc between two directions, counter-clockwise.
  const n = (x: number) => ((x % 360) + 360) % 360;
  const A = n(a);
  const B = n(b);
  const diff = n(B - A);
  return diff <= 180 ? [A, B] : [B, A];
}
