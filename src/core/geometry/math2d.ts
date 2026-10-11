import type { Vec2 } from '../schema/elements';

export const EPS = 1e-6;

export const v2 = (x: number, z: number): Vec2 => ({ x, z });
export const add2 = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, z: a.z + b.z });
export const sub2 = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, z: a.z - b.z });
export const scale2 = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, z: a.z * s });
export const dot2 = (a: Vec2, b: Vec2) => a.x * b.x + a.z * b.z;
export const len2 = (a: Vec2) => Math.hypot(a.x, a.z);
export const dist2 = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);
export const lerp2 = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
export const norm2 = (a: Vec2): Vec2 => {
  const l = len2(a);
  return l < EPS ? { x: 1, z: 0 } : { x: a.x / l, z: a.z / l };
};
/** Left-hand perpendicular in plan (rotates +90° from x towards -z). */
export const perp2 = (a: Vec2): Vec2 => ({ x: a.z, z: -a.x });
export const round = (v: number, digits = 4) => Math.round(v * 10 ** digits) / 10 ** digits;
export const roundVec2 = (a: Vec2, digits = 4): Vec2 => ({ x: round(a.x, digits), z: round(a.z, digits) });

export function rotate2(p: Vec2, angle: number, about: Vec2 = { x: 0, z: 0 }): Vec2 {
  // Matches THREE rotation around +Y: x' = x cos + z sin, z' = -x sin + z cos
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const dx = p.x - about.x;
  const dz = p.z - about.z;
  return { x: about.x + dx * c + dz * s, z: about.z - dx * s + dz * c };
}

export function polygonArea(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.z - q.x * p.z;
  }
  return a / 2;
}

export function polygonCentroid(poly: Vec2[]): Vec2 {
  const a = polygonArea(poly);
  if (Math.abs(a) < EPS) {
    const s = poly.reduce((acc, p) => add2(acc, p), { x: 0, z: 0 });
    return scale2(s, 1 / poly.length);
  }
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const f = p.x * q.z - q.x * p.z;
    cx += (p.x + q.x) * f;
    cz += (p.z + q.z) * f;
  }
  return { x: cx / (6 * a), z: cz / (6 * a) };
}

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

export function bounds2(points: Vec2[]) {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minZ = Math.min(minZ, p.z);
    maxX = Math.max(maxX, p.x);
    maxZ = Math.max(maxZ, p.z);
  }
  return { minX, minZ, maxX, maxZ };
}

/** Closest point parameter t∈[0,1] on segment ab, and the distance. */
export function projectOnSegment(p: Vec2, a: Vec2, b: Vec2): { t: number; dist: number; point: Vec2 } {
  const ab = sub2(b, a);
  const l2 = dot2(ab, ab);
  const t = l2 < EPS ? 0 : Math.max(0, Math.min(1, dot2(sub2(p, a), ab) / l2));
  const point = lerp2(a, b, t);
  return { t, dist: dist2(p, point), point };
}
