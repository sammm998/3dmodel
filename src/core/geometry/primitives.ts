/**
 * Geometry primitives with real-world (meter based) UV mapping, so tiled PBR
 * textures keep a constant physical scale on every object.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/** Box geometry whose UVs are expressed in meters on each face. */
export function boxGeometry(w: number, h: number, d: number): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(Math.max(w, 1e-4), Math.max(h, 1e-4), Math.max(d, 1e-4));
  const uv = g.attributes.uv as THREE.BufferAttribute;
  // Face order: +x, -x, +y, -y, +z, -z; 4 vertices each (no segments).
  const dims: [number, number][] = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let i = 0; i < uv.count; i++) {
    const [su, sv] = dims[Math.floor(i / 4)];
    uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  }
  uv.needsUpdate = true;
  return g;
}

/** Builds a flat-shaded geometry from planar polygons (outer faces CCW seen from outside). */
export function polygonsGeometry(polys: THREE.Vector3[][]): THREE.BufferGeometry {
  const pos: number[] = [];
  const uvs: number[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (const poly of polys) {
    if (poly.length < 3) continue;
    const n = new THREE.Vector3()
      .subVectors(poly[1], poly[0])
      .cross(new THREE.Vector3().subVectors(poly[2], poly[0]));
    // Newell normal for robustness
    n.set(0, 0, 0);
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      n.x += (a.y - b.y) * (a.z + b.z);
      n.y += (a.z - b.z) * (a.x + b.x);
      n.z += (a.x - b.x) * (a.y + b.y);
    }
    n.normalize();
    let uAxis = new THREE.Vector3().crossVectors(up, n);
    if (uAxis.lengthSq() < 1e-6) uAxis = new THREE.Vector3(1, 0, 0);
    uAxis.normalize();
    const vAxis = new THREE.Vector3().crossVectors(n, uAxis).normalize();
    // Triangulate in the face plane (handles concave faces).
    const pts2 = poly.map((p) => new THREE.Vector2(p.dot(uAxis), p.dot(vAxis)));
    const tris = THREE.ShapeUtils.triangulateShape(pts2, []);
    for (const t of tris) {
      // (uAxis, vAxis, n) is right-handed: CCW in uv space faces along n.
      const [a, b, c] = [pts2[t[0]], pts2[t[1]], pts2[t[2]]];
      const ccw = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) > 0;
      const order = ccw ? [t[0], t[1], t[2]] : [t[0], t[2], t[1]];
      for (const idx of order) {
        const p = poly[idx];
        pos.push(p.x, p.y, p.z);
        uvs.push(pts2[idx].x, pts2[idx].y);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return g;
}

/**
 * Prism from a planar polygon swept along `offset` (all faces outward).
 * The polygon must be CCW when viewed against the offset direction.
 */
export function prismPolygons(base: THREE.Vector3[], offset: THREE.Vector3): THREE.Vector3[][] {
  const top = base.map((p) => p.clone().add(offset));
  const faces: THREE.Vector3[][] = [top, [...base].reverse()];
  for (let i = 0; i < base.length; i++) {
    const a = base[i];
    const b = base[(i + 1) % base.length];
    faces.push([a, b, top[(i + 1) % base.length], top[i]]);
  }
  return faces;
}

/** Ensures every face's normal points away from the centroid of all vertices. */
export function orientOutward(faces: THREE.Vector3[][]): THREE.Vector3[][] {
  const c = new THREE.Vector3();
  let n = 0;
  for (const f of faces)
    for (const p of f) {
      c.add(p);
      n++;
    }
  c.divideScalar(Math.max(n, 1));
  return faces.map((f) => {
    const fc = f.reduce((acc, p) => acc.add(p), new THREE.Vector3()).divideScalar(f.length);
    const nrm = new THREE.Vector3();
    for (let i = 0; i < f.length; i++) {
      const a = f[i];
      const b = f[(i + 1) % f.length];
      nrm.x += (a.y - b.y) * (a.z + b.z);
      nrm.y += (a.z - b.z) * (a.x + b.x);
      nrm.z += (a.x - b.x) * (a.y + b.y);
    }
    return nrm.dot(fc.sub(c)) < 0 ? [...f].reverse() : f;
  });
}

/** Scales a geometry's 0..1 UVs to metres (so tiled materials keep their real size). */
function scaleUV(g: THREE.BufferGeometry, su: number, sv: number) {
  const uv = g.attributes.uv as THREE.BufferAttribute | undefined;
  if (!uv) return g;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  uv.needsUpdate = true;
  return g;
}

/** Box-projected UVs in metres from positions and normals (any shape). */
function projectUV(g: THREE.BufferGeometry) {
  const p = g.attributes.position as THREE.BufferAttribute;
  const n = g.attributes.normal as THREE.BufferAttribute;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    const az = Math.abs(n.getZ(i));
    const [u, v] = ax >= ay && ax >= az ? [p.getZ(i), p.getY(i)] : ay >= az ? [p.getX(i), p.getZ(i)] : [p.getX(i), p.getY(i)];
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

export interface SolidSpec {
  shape: 'box' | 'cylinder' | 'sphere' | 'cone' | 'torus' | 'capsule';
  width: number;
  height: number;
  depth: number;
  cornerRadius?: number;
  thickness?: number;
  taper?: number;
  arcDeg?: number;
}

/**
 * Smooth geometry for a generic solid, centred on the origin and filling its
 * width × height × depth bounding box. UVs are in metres.
 */
export function solidGeometry(s: SolidSpec): THREE.BufferGeometry {
  const w = Math.max(s.width, 1e-3);
  const h = Math.max(s.height, 1e-3);
  const d = Math.max(s.depth, 1e-3);
  const arc = ((s.arcDeg ?? 360) * Math.PI) / 180;
  const full = arc >= Math.PI * 2 - 1e-6;
  switch (s.shape) {
    case 'cylinder':
    case 'cone': {
      const taper = s.taper ?? (s.shape === 'cone' ? 0 : 1);
      // Unit radius 0.5 bottom, scaled to the box; more segments for big round things.
      const seg = Math.min(96, Math.max(24, Math.round(Math.max(w, d) * 24)));
      const g = new THREE.CylinderGeometry(0.5 * taper, 0.5, 1, seg, 1, false, 0, arc);
      scaleUV(g, Math.PI * (w + d) * 0.5 * (arc / (Math.PI * 2)), h);
      g.scale(w, h, d);
      return g;
    }
    case 'sphere': {
      const g = new THREE.SphereGeometry(0.5, 48, 32);
      scaleUV(g, (Math.PI * (w + d)) / 2, (Math.PI * h) / 2);
      g.scale(w, h, d);
      return g;
    }
    case 'capsule': {
      const r = Math.min(w, d) / 2;
      const g = new THREE.CapsuleGeometry(r, Math.max(0, h - 2 * r), 12, 40);
      g.scale(w / (2 * r), 1, d / (2 * r));
      g.computeVertexNormals();
      return projectUV(g);
    }
    case 'torus': {
      const t = Math.min(s.thickness ?? Math.min(w, h) * 0.08, Math.min(w, h) * 0.9);
      const a = Math.max((w - t) / 2, 1e-3);
      const b = Math.max((h - t) / 2, 1e-3);
      const tubeSeg = Math.min(32, Math.max(12, Math.round(t * 40)));
      const sweep = full ? Math.PI * 2 : arc;
      let g: THREE.BufferGeometry;
      if (Math.abs(a - b) < 1e-4) {
        const radSeg = Math.min(256, Math.max(48, Math.round(a * 24)));
        g = new THREE.TorusGeometry(a, t / 2, tubeSeg, radSeg, sweep);
        scaleUV(g, a * sweep, Math.PI * t);
      } else {
        // Elliptic ring: sweep a round tube along the ellipse so the tube stays round.
        const path = new EllipsePath(a, b, sweep);
        const len = path.getLength();
        g = new THREE.TubeGeometry(path, Math.min(256, Math.max(48, Math.round(len * 4))), t / 2, tubeSeg, full);
        scaleUV(g, len, Math.PI * t);
      }
      // A flattened ring when depth is less than the tube.
      if (d < t - 1e-6) g.scale(1, 1, d / t);
      return g;
    }
    default: {
      const r = Math.min(s.cornerRadius ?? 0, w / 2, h / 2, d / 2);
      if (r > 0.002) {
        const g = new RoundedBoxGeometry(w, h, d, 4, r);
        return projectUV(g);
      }
      return boxGeometry(w, h, d);
    }
  }
}

/** Ellipse in the X–Y plane as a 3D curve (for elliptic rings). */
class EllipsePath extends THREE.Curve<THREE.Vector3> {
  constructor(
    private a: number,
    private b: number,
    private sweep: number,
  ) {
    super();
  }
  override getPoint(t: number, target = new THREE.Vector3()) {
    const u = t * this.sweep;
    return target.set(this.a * Math.cos(u), this.b * Math.sin(u), 0);
  }
}
