/**
 * Geometry primitives with real-world (meter based) UV mapping, so tiled PBR
 * textures keep a constant physical scale on every object.
 */
import * as THREE from 'three';

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
