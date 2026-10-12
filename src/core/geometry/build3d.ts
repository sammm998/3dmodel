/**
 * Deterministic parametric geometry: scene elements → THREE.Object3D.
 *
 * Runs in the browser (viewport, exporters) and in Node (tests). Materials
 * are injected so the same geometry can be rendered with procedural PBR
 * textures, technical colours, or plain export materials.
 * Every mesh carries `userData.elementId` for picking.
 */
import * as THREE from 'three';
import type {
  ColumnElement,
  DoorElement,
  Element,
  FurnitureElement,
  PoolElement,
  RoofElement,
  SkylightElement,
  SlabElement,
  StairElement,
  TerrainElement,
  Vec2,
  WallElement,
  WindowElement,
} from '../schema/elements';
import type { Scene } from '../schema/scene';
import { computeWallExtensions, findElement, levelOf, wallFrame } from '../scene/query';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { boxGeometry, orientOutward, polygonsGeometry, prismPolygons } from './primitives';

export type MaterialFn = (ref: string) => THREE.Material;

export interface BuildContext {
  scene: Scene;
  material: MaterialFn;
  wallExtensions: Map<string, { start: number; end: number }>;
  /** Include non-physical helpers such as room zones. */
  includeHelpers?: boolean;
}

export function createBuildContext(scene: Scene, material: MaterialFn, includeHelpers = true): BuildContext {
  const walls = scene.elements.filter((e): e is WallElement => e.type === 'wall');
  return { scene, material, wallExtensions: computeWallExtensions(walls), includeHelpers };
}

const tag = (obj: THREE.Object3D, id: string) => {
  obj.userData.elementId = id;
  obj.traverse((c) => {
    c.userData.elementId = id;
    const m = c as THREE.Mesh;
    if (m.isMesh) {
      // Glass and water let light through: they must not cast solid shadows.
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const glassy = mats.every((x) => (x as THREE.MeshPhysicalMaterial).transmission > 0 || (x.transparent && x.opacity < 0.9));
      m.castShadow = !glassy;
      m.receiveShadow = true;
    }
  });
  return obj;
};

function addBox(parent: THREE.Object3D, mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, name?: string) {
  const m = new THREE.Mesh(boxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  if (name) m.name = name;
  parent.add(m);
  return m;
}

function addCyl(parent: THREE.Object3D, mat: THREE.Material, rTop: number, rBottom: number, h: number, x: number, y: number, z: number, seg = 24) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, seg), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

/** Builds the object for one element, positioned in world space. */
export function buildElementObject(el: Element, ctx: BuildContext): THREE.Object3D | null {
  const lvl = levelOf(ctx.scene, el);
  let obj: THREE.Object3D | null = null;
  switch (el.type) {
    case 'wall':
      obj = buildWall(el, ctx, lvl.elevation);
      break;
    case 'window':
      obj = buildWindow(el, ctx, lvl.elevation);
      break;
    case 'door':
      obj = buildDoor(el, ctx, lvl.elevation);
      break;
    case 'slab':
      obj = buildSlab(el, ctx, lvl.elevation);
      break;
    case 'roof':
      obj = buildRoof(el, ctx, lvl.elevation);
      break;
    case 'skylight':
      obj = buildSkylight(el, ctx, lvl.elevation);
      break;
    case 'stair':
      obj = buildStair(el, ctx, lvl.elevation);
      break;
    case 'column':
      obj = buildColumn(el, ctx, lvl.elevation);
      break;
    case 'beam': {
      const g = new THREE.Group();
      const a = new THREE.Vector3(el.start.x, lvl.elevation + el.start.y, el.start.z);
      const b = new THREE.Vector3(el.end.x, lvl.elevation + el.end.y, el.end.z);
      const len = a.distanceTo(b);
      const m = addBox(g, ctx.material(el.material), len, el.depth, el.width, 0, 0, 0);
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), b.clone().sub(a).normalize());
      obj = g;
      break;
    }
    case 'room':
      obj = ctx.includeHelpers ? buildRoomZone(el.polygon, ctx, lvl.elevation) : null;
      break;
    case 'furniture':
      obj = buildFurniture(el, ctx, lvl.elevation);
      break;
    case 'terrain':
      obj = buildTerrain(el, ctx, lvl.elevation);
      break;
    case 'pool':
      obj = buildPool(el, ctx, lvl.elevation);
      break;
    case 'box': {
      const g = new THREE.Group();
      addBox(g, ctx.material(el.material), el.width, el.height, el.depth, 0, el.height / 2, 0);
      g.position.set(el.position.x, lvl.elevation + el.position.y, el.position.z);
      g.rotation.y = el.rotation;
      obj = g;
      break;
    }
  }
  if (!obj) return null;
  if (el.type !== 'room') obj = mergeByMaterial(obj);
  obj.name = el.name;
  if (el.type === 'room') {
    obj.userData.elementId = el.id;
    obj.traverse((c) => (c.userData.elementId = el.id));
    return obj;
  }
  return tag(obj, el.id);
}

const KEEP_ATTRS = new Set(['position', 'normal', 'uv']);

/**
 * Bakes an element's many small parts into one mesh per material. Keeps the
 * element's root transform, so picking, gizmos and outlines work unchanged,
 * while draw calls drop by an order of magnitude (smoother viewport).
 */
export function mergeByMaterial(root: THREE.Object3D): THREE.Object3D {
  const meshes: THREE.Mesh[] = [];
  let mergeable = true;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (Array.isArray(m.material) || m.userData.helper) mergeable = false;
    meshes.push(m);
  });
  if (!mergeable || meshes.length <= 1) return root;
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; shadow: boolean }>();
  for (const m of meshes) {
    const src = m.geometry as THREE.BufferGeometry;
    const g = src.index ? src.toNonIndexed() : src.clone();
    g.clearGroups();
    for (const name of Object.keys(g.attributes)) if (!KEEP_ATTRS.has(name)) g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((g.attributes.position.count * 2)), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    const mat = m.material as THREE.Material;
    const b = buckets.get(mat) ?? { geos: [], shadow: false };
    b.geos.push(g);
    if (m.castShadow !== false) b.shadow = true;
    buckets.set(mat, b);
    src.dispose();
  }
  const out = new THREE.Group();
  out.position.copy(root.position);
  out.quaternion.copy(root.quaternion);
  out.scale.copy(root.scale);
  for (const [mat, b] of buckets) {
    const merged = mergeGeometries(b.geos, false);
    for (const g of b.geos) g.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.name = mat.name;
    const glassy = (mat as THREE.MeshPhysicalMaterial).transmission > 0 || (mat.transparent && mat.opacity < 0.9);
    mesh.castShadow = b.shadow && !glassy;
    mesh.receiveShadow = true;
    out.add(mesh);
  }
  return out;
}

/** Builds every visible element into one group (used by exporters). */
export function buildSceneGroup(scene: Scene, material: MaterialFn, opts: { includeHelpers?: boolean; ids?: Set<string> } = {}): THREE.Group {
  const ctx = createBuildContext(scene, material, opts.includeHelpers ?? false);
  const root = new THREE.Group();
  root.name = 'Scene';
  for (const el of scene.elements) {
    if (el.hidden) continue;
    if (opts.ids && !opts.ids.has(el.id)) continue;
    const o = buildElementObject(el, ctx);
    if (!o) continue;
    o.userData = { ...o.userData, elementId: el.id, elementType: el.type, levelId: el.levelId ?? scene.levels[0].id };
    root.add(o);
  }
  return root;
}

// ---- Walls ------------------------------------------------------------------
interface OpeningRect {
  a: number;
  b: number;
  bottom: number;
  top: number;
}

/** Opening rectangles of a wall in wall-local (u, v) coordinates. */
export function wallOpenings(scene: Scene, wall: WallElement): OpeningRect[] {
  const out: OpeningRect[] = [];
  for (const e of scene.elements) {
    if ((e.type === 'window' || e.type === 'door') && e.hostId === wall.id && !e.hidden) {
      const bottom = e.type === 'window' ? e.sillHeight : 0;
      out.push({ a: e.offset - e.width / 2, b: e.offset + e.width / 2, bottom, top: bottom + e.height });
    }
  }
  return out.sort((p, q) => p.a - q.a);
}

function wallMaterials(w: WallElement, ctx: BuildContext): { front: THREE.Material; back: THREE.Material; sides: THREE.Material } {
  const ext = ctx.material(w.material);
  const int = ctx.material(w.interiorMaterial ?? w.material);
  if (!w.exterior || !w.interiorMaterial) return { front: ext, back: w.interiorMaterial ? int : ext, sides: ext };
  // Local +z of the wall in world space is (-dir.z, dir.x).
  const f = wallFrame(w);
  const ox = Number(w.bim?.outwardX ?? 0);
  const oz = Number(w.bim?.outwardZ ?? 0);
  const frontIsExterior = -f.dir.z * ox + f.dir.x * oz >= 0;
  return frontIsExterior ? { front: ext, back: int, sides: ext } : { front: int, back: ext, sides: ext };
}

function buildWall(w: WallElement, ctx: BuildContext, y0: number): THREE.Object3D {
  const f = wallFrame(w);
  const ext = ctx.wallExtensions.get(w.id) ?? { start: 0, end: 0 };
  const u0 = -ext.start;
  const u1 = f.length + ext.end;
  const H = w.height;
  const openings = wallOpenings(ctx.scene, w)
    .map((o) => ({
      a: Math.max(o.a, u0 + 0.005),
      b: Math.min(o.b, u1 - 0.005),
      bottom: Math.max(0, o.bottom),
      top: Math.min(o.top, H - 0.005),
    }))
    .filter((o) => o.b - o.a > 0.01 && o.top - o.bottom > 0.01);

  const notches = openings.filter((o) => o.bottom <= 1e-3);
  const holes = openings.filter((o) => o.bottom > 1e-3);
  const shape = new THREE.Shape();
  shape.moveTo(u0, 0);
  for (const n of notches) {
    shape.lineTo(n.a, 0);
    shape.lineTo(n.a, n.top);
    shape.lineTo(n.b, n.top);
    shape.lineTo(n.b, 0);
  }
  shape.lineTo(u1, 0);
  shape.lineTo(u1, H);
  shape.lineTo(u0, H);
  shape.lineTo(u0, 0);
  for (const h of holes) {
    const p = new THREE.Path();
    p.moveTo(h.a, h.bottom);
    p.lineTo(h.a, h.top);
    p.lineTo(h.b, h.top);
    p.lineTo(h.b, h.bottom);
    p.lineTo(h.a, h.bottom);
    shape.holes.push(p);
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: w.thickness, bevelEnabled: false, steps: 1 });
  geo.translate(0, 0, -w.thickness / 2);
  // Split lid group into back (z-) and front (z+) faces for separate finishes.
  const lid = geo.groups.find((g) => g.materialIndex === 0);
  const side = geo.groups.find((g) => g.materialIndex === 1);
  if (lid && side) {
    const half = lid.count / 2;
    geo.clearGroups();
    geo.addGroup(lid.start, half, 0);
    geo.addGroup(lid.start + half, half, 2);
    geo.addGroup(side.start, side.count, 1);
  }
  const mats = wallMaterials(w, ctx);
  const mesh = new THREE.Mesh(geo, [mats.back, mats.sides, mats.front]);
  const g = new THREE.Group();
  g.add(mesh);
  g.position.set(w.start.x, y0 + w.baseOffset, w.start.z);
  g.rotation.y = f.angle;
  return g;
}

function hostFrame(scene: Scene, hostId: string, y0: number): { wall: WallElement; group: THREE.Group } | null {
  const host = findElement(scene, hostId);
  if (!host || host.type !== 'wall') return null;
  const f = wallFrame(host);
  const g = new THREE.Group();
  g.position.set(host.start.x, y0 + host.baseOffset, host.start.z);
  g.rotation.y = f.angle;
  return { wall: host, group: g };
}

// ---- Windows ----------------------------------------------------------------
function buildWindow(el: WindowElement, ctx: BuildContext, y0: number): THREE.Object3D | null {
  const hf = hostFrame(ctx.scene, el.hostId, y0);
  if (!hf) return null;
  const frame = ctx.material(el.frameMaterial);
  const glass = ctx.material(el.glazingMaterial);
  // Inset 2 mm from the opening so frame faces never coincide with the wall reveal.
  const w = el.width - 0.004;
  const h = el.height - 0.004;
  const fw = Math.min(el.frameWidth, w / 4, h / 4);
  const fd = Math.min(el.frameDepth, hf.wall.thickness + 0.02);
  const win = new THREE.Group();
  win.position.set(el.offset, el.sillHeight + 0.002, 0);
  addBox(win, frame, fw, h, fd, -w / 2 + fw / 2, h / 2, 0, 'frame');
  addBox(win, frame, fw, h, fd, w / 2 - fw / 2, h / 2, 0, 'frame');
  addBox(win, frame, w, fw, fd, 0, h - fw / 2, 0, 'frame');
  addBox(win, frame, w, fw, fd, 0, fw / 2, 0, 'frame');
  let vMull = el.mullionsVertical;
  if (el.style === 'sliding' && vMull === 0) vMull = 1;
  if (el.style === 'casement' && vMull === 0 && w > 1.4) vMull = 1;
  const innerW = w - 2 * fw;
  const innerH = h - 2 * fw;
  const mw = fw * 0.8;
  for (let i = 1; i <= vMull; i++) addBox(win, frame, mw, innerH, fd * 0.85, -w / 2 + fw + (innerW * i) / (vMull + 1), h / 2, 0, 'mullion');
  for (let j = 1; j <= el.mullionsHorizontal; j++) addBox(win, frame, innerW, mw, fd * 0.85, 0, fw + (innerH * j) / (el.mullionsHorizontal + 1), 0, 'transom');
  if (el.style === 'casement') {
    // Sash profiles inside each light.
    const lights = vMull + 1;
    const lw = innerW / lights;
    for (let i = 0; i < lights; i++) {
      const cx = -w / 2 + fw + lw * (i + 0.5);
      const s = fw * 0.55;
      addBox(win, frame, s, innerH, fd * 0.6, cx - lw / 2 + s / 2 + mw / 2, h / 2, 0.005);
      addBox(win, frame, s, innerH, fd * 0.6, cx + lw / 2 - s / 2 - mw / 2, h / 2, 0.005);
      addBox(win, frame, lw - mw, s, fd * 0.6, cx, fw + s / 2, 0.005);
      addBox(win, frame, lw - mw, s, fd * 0.6, cx, h - fw - s / 2, 0.005);
    }
  }
  const pane = addBox(win, glass, innerW, innerH, 0.012, 0, h / 2, 0, 'glass');
  pane.castShadow = false;
  hf.group.add(win);
  return hf.group;
}

// ---- Doors --------------------------------------------------------------------
function buildDoor(el: DoorElement, ctx: BuildContext, y0: number): THREE.Object3D | null {
  const hf = hostFrame(ctx.scene, el.hostId, y0);
  if (!hf) return null;
  const frame = ctx.material(el.frameMaterial);
  const leaf = ctx.material(el.leafMaterial);
  // Inset 2 mm from the opening so frame faces never coincide with the wall reveal.
  const w = el.width - 0.004;
  const h = el.height - 0.002;
  const fw = 0.06;
  const fd = Math.min(el.frameDepth, hf.wall.thickness + 0.02);
  const d = new THREE.Group();
  d.position.set(el.offset, 0, 0);
  if (el.doorType !== 'opening') {
    addBox(d, frame, fw, h, fd, -w / 2 + fw / 2, h / 2, 0);
    addBox(d, frame, fw, h, fd, w / 2 - fw / 2, h / 2, 0);
    addBox(d, frame, w, fw, fd, 0, h - fw / 2, 0);
  }
  const iw = w - 2 * fw;
  const ih = h - fw;
  const handleMat = ctx.material('steel');
  switch (el.doorType) {
    case 'hinged': {
      addBox(d, leaf, iw - 0.006, ih - 0.006, 0.045, 0, ih / 2, 0);
      const hx = el.swing === 'left' ? iw / 2 - 0.08 : -iw / 2 + 0.08;
      addBox(d, handleMat, 0.12, 0.02, 0.02, hx - (el.swing === 'left' ? 0.05 : -0.05), 1.0, 0.045);
      addBox(d, handleMat, 0.12, 0.02, 0.02, hx - (el.swing === 'left' ? 0.05 : -0.05), 1.0, -0.045);
      break;
    }
    case 'double': {
      for (const sx of [-1, 1]) {
        addBox(d, leaf, iw / 2 - 0.006, ih - 0.006, 0.045, (sx * iw) / 4, ih / 2, 0);
        addBox(d, handleMat, 0.02, 0.3, 0.02, sx * 0.06, 1.05, 0.045);
      }
      break;
    }
    case 'sliding': {
      addBox(d, leaf, iw / 2 + 0.05, ih - 0.01, 0.04, -iw / 4, ih / 2, 0.025);
      addBox(d, leaf, iw / 2 + 0.05, ih - 0.01, 0.04, iw / 4, ih / 2, -0.025);
      break;
    }
    case 'sliding_glass': {
      const glass = ctx.material('glass_clear');
      for (const [sx, sz] of [
        [-1, 0.03],
        [1, -0.03],
      ] as const) {
        const pw = iw / 2 + 0.04;
        const px = (sx * iw) / 4;
        const p = new THREE.Group();
        p.position.set(px, 0, sz);
        addBox(p, frame, 0.05, ih, 0.05, -pw / 2 + 0.025, ih / 2, 0);
        addBox(p, frame, 0.05, ih, 0.05, pw / 2 - 0.025, ih / 2, 0);
        addBox(p, frame, pw, 0.05, 0.05, 0, ih - 0.025, 0);
        addBox(p, frame, pw, 0.08, 0.05, 0, 0.04, 0);
        addBox(p, glass, pw - 0.1, ih - 0.13, 0.012, 0, ih / 2 + 0.015, 0).castShadow = false;
        d.add(p);
      }
      break;
    }
    case 'garage': {
      const panels = Math.max(3, Math.round(ih / 0.55));
      const ph = ih / panels;
      for (let i = 0; i < panels; i++) addBox(d, leaf, iw, ph - 0.01, 0.05, 0, ph * (i + 0.5), 0);
      break;
    }
    case 'opening':
      break;
  }
  hf.group.add(d);
  return hf.group;
}

// ---- Slabs / rooms ------------------------------------------------------------
function polygonShape(poly: Vec2[]): THREE.Shape {
  const s = new THREE.Shape();
  poly.forEach((p, i) => (i === 0 ? s.moveTo(p.x, -p.z) : s.lineTo(p.x, -p.z)));
  s.closePath();
  return s;
}

function buildSlab(el: SlabElement, ctx: BuildContext, y0: number): THREE.Object3D {
  const geo = new THREE.ExtrudeGeometry(polygonShape(el.polygon), { depth: el.thickness, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, ctx.material(el.material));
  // +2 mm: keeps the floor surface off the coplanar wall top/bottom faces (no z-fighting).
  mesh.position.y = y0 + el.elevation - el.thickness + 0.002;
  const g = new THREE.Group();
  g.add(mesh);
  return g;
}

function buildRoomZone(poly: Vec2[], ctx: BuildContext, y0: number): THREE.Object3D {
  const geo = new THREE.ShapeGeometry(polygonShape(poly));
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, ctx.material('__room'));
  mesh.position.y = y0 + 0.012;
  mesh.renderOrder = 1;
  // Zones are informational: never intercept picking of the floor beneath.
  mesh.raycast = () => {};
  mesh.userData.helper = true;
  const g = new THREE.Group();
  g.add(mesh);
  g.userData.helper = true;
  return g;
}

// ---- Roofs ------------------------------------------------------------------
interface RoofFrame {
  /** Half extents at the wall line in generation frame (ridge along x). */
  a: number;
  b: number;
  extraRot: number;
  tanp: number;
  tv: number;
}

export function roofFrame(r: RoofElement): RoofFrame {
  const swap = r.roofType === 'hip' ? r.depth > r.width : r.ridgeAxis === 'z';
  const a = (swap ? r.depth : r.width) / 2;
  const b = (swap ? r.width : r.depth) / 2;
  const p = r.roofType === 'flat' ? 0 : (r.pitchDeg * Math.PI) / 180;
  const tanp = Math.tan(p);
  return { a, b, extraRot: swap ? Math.PI / 2 : 0, tanp, tv: r.thickness / Math.max(Math.cos(p), 0.2) };
}

/** Underside height (relative to the eave) at a point in generation frame. */
export function roofHeightLocal(r: RoofElement, f: RoofFrame, gx: number, gz: number): number {
  switch (r.roofType) {
    case 'flat':
      return 0;
    case 'shed':
      return (f.b - gz) * f.tanp;
    case 'gable':
      return (f.b - Math.abs(gz)) * f.tanp;
    case 'hip':
      return Math.min(f.b - Math.abs(gz), f.a - Math.abs(gx)) * f.tanp;
  }
}

function buildRoof(r: RoofElement, ctx: BuildContext, y0: number): THREE.Object3D {
  const f = roofFrame(r);
  const o = r.overhang;
  const A = f.a + o;
  const B = f.b + o;
  const drop = -o * f.tanp;
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  let faces: THREE.Vector3[][] = [];
  switch (r.roofType) {
    case 'flat':
      faces = [[V(-A, 0, B), V(A, 0, B), V(A, 0, -B), V(-A, 0, -B)]];
      break;
    case 'shed': {
      const hi = (f.b + B) * f.tanp;
      faces = [[V(-A, drop, B), V(A, drop, B), V(A, hi, -B), V(-A, hi, -B)]];
      break;
    }
    case 'gable': {
      const ridge = f.b * f.tanp;
      faces = [
        [V(-A, drop, B), V(A, drop, B), V(A, ridge, 0), V(-A, ridge, 0)],
        [V(A, drop, -B), V(-A, drop, -B), V(-A, ridge, 0), V(A, ridge, 0)],
      ];
      break;
    }
    case 'hip': {
      const ridge = f.b * f.tanp;
      const rx = Math.max(0, f.a - f.b);
      faces = [
        [V(-A, drop, B), V(A, drop, B), V(rx, ridge, 0), V(-rx, ridge, 0)],
        [V(A, drop, -B), V(-A, drop, -B), V(-rx, ridge, 0), V(rx, ridge, 0)],
        [V(A, drop, B), V(A, drop, -B), V(rx, ridge, 0)],
        [V(-A, drop, -B), V(-A, drop, B), V(-rx, ridge, 0)],
      ].map((face) => face.filter((p, i, arr) => i === 0 || p.distanceTo(arr[i - 1]) > 1e-6));
      break;
    }
  }
  const thick = r.roofType === 'flat' ? r.thickness : f.tv;
  const solids: THREE.Vector3[][] = [];
  for (const face of faces) {
    if (face.length < 3) continue;
    solids.push(...orientOutward(prismPolygons(face, new THREE.Vector3(0, thick, 0))));
  }
  const g = new THREE.Group();
  const inner = new THREE.Group();
  inner.rotation.y = f.extraRot;
  inner.add(new THREE.Mesh(polygonsGeometry(solids), ctx.material(r.material)));

  if (r.roofType === 'gable' && f.tanp > 0) {
    // Gable-end infill above the walls.
    const gm = ctx.material(r.gableMaterial ?? 'plaster_white');
    const ridge = f.b * f.tanp;
    for (const sx of [-1, 1]) {
      const x0 = sx * f.a;
      const tri = [V(x0, 0, f.b), V(x0, 0, -f.b), V(x0, ridge, 0)];
      inner.add(new THREE.Mesh(polygonsGeometry(orientOutward(prismPolygons(tri, V(-sx * 0.25, 0, 0)))), gm));
    }
  }
  if (r.roofType === 'shed' && f.tanp > 0) {
    const gm = ctx.material(r.gableMaterial ?? 'plaster_white');
    const hi = 2 * f.b * f.tanp;
    for (const sx of [-1, 1]) {
      const x0 = sx * f.a;
      const tri = [V(x0, 0, f.b), V(x0, 0, -f.b), V(x0, hi, -f.b)];
      inner.add(new THREE.Mesh(polygonsGeometry(orientOutward(prismPolygons(tri, V(-sx * 0.25, 0, 0)))), gm));
    }
    // back wall infill
    const back = [V(-f.a, 0, -f.b), V(f.a, 0, -f.b), V(f.a, hi, -f.b), V(-f.a, hi, -f.b)];
    inner.add(new THREE.Mesh(polygonsGeometry(orientOutward(prismPolygons(back, V(0, 0, 0.25)))), gm));
  }
  if (r.roofType === 'flat' && r.parapetHeight > 0) {
    const pm = ctx.material(r.gableMaterial ?? r.material);
    const ph = r.parapetHeight;
    const t = 0.2;
    addBox(inner, pm, 2 * A, ph, t, 0, thick + ph / 2, B - t / 2);
    addBox(inner, pm, 2 * A, ph, t, 0, thick + ph / 2, -B + t / 2);
    addBox(inner, pm, t, ph, 2 * B - 2 * t, A - t / 2, thick + ph / 2, 0);
    addBox(inner, pm, t, ph, 2 * B - 2 * t, -A + t / 2, thick + ph / 2, 0);
  }
  g.add(inner);
  g.position.set(r.center.x, y0 + r.baseOffset, r.center.z);
  g.rotation.y = r.rotation;
  return g;
}

function buildSkylight(el: SkylightElement, ctx: BuildContext, y0: number): THREE.Object3D | null {
  const roof = findElement(ctx.scene, el.hostId);
  if (!roof || roof.type !== 'roof') return null;
  const f = roofFrame(roof);
  // (u, v) are in the roof's rotated plan frame; convert to generation frame.
  const c = Math.cos(-f.extraRot);
  const s = Math.sin(-f.extraRot);
  const gx = el.u * c + el.v * s;
  const gz = -el.u * s + el.v * c;
  const h = roofHeightLocal(roof, f, gx, gz) + (roof.roofType === 'flat' ? roof.thickness : f.tv);
  const eps = 0.02;
  const hx = (roofHeightLocal(roof, f, gx + eps, gz) - roofHeightLocal(roof, f, gx - eps, gz)) / (2 * eps);
  const hz = (roofHeightLocal(roof, f, gx, gz + eps) - roofHeightLocal(roof, f, gx, gz - eps)) / (2 * eps);
  const n = new THREE.Vector3(-hx, 1, -hz).normalize();
  const frame = ctx.material(el.frameMaterial);
  const glass = ctx.material(el.glazingMaterial);
  const sk = new THREE.Group();
  const W = el.width;
  const L = el.length;
  const t = 0.07;
  addBox(sk, frame, W, 0.12, t, 0, 0.06, L / 2 - t / 2);
  addBox(sk, frame, W, 0.12, t, 0, 0.06, -L / 2 + t / 2);
  addBox(sk, frame, t, 0.12, L - 2 * t, W / 2 - t / 2, 0.06, 0);
  addBox(sk, frame, t, 0.12, L - 2 * t, -W / 2 + t / 2, 0.06, 0);
  addBox(sk, glass, W - 2 * t, 0.012, L - 2 * t, 0, 0.1, 0).castShadow = false;
  sk.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
  sk.position.set(gx, h, gz);
  const inner = new THREE.Group();
  inner.rotation.y = f.extraRot;
  inner.add(sk);
  const g = new THREE.Group();
  g.add(inner);
  g.position.set(roof.center.x, y0 + roof.baseOffset, roof.center.z);
  g.rotation.y = roof.rotation;
  return g;
}

// ---- Stairs / columns -----------------------------------------------------------
function buildStair(el: StairElement, ctx: BuildContext, y0: number): THREE.Object3D {
  const g = new THREE.Group();
  const mat = ctx.material(el.material);
  const steel = ctx.material('aluminium_black');
  const r = el.totalRise / el.steps;
  const go = el.totalRun / el.steps;
  for (let i = 0; i < el.steps; i++) {
    addBox(g, mat, el.width, 0.045, go + 0.03, 0, (i + 1) * r - 0.0225, -(i + 0.5) * go);
  }
  const len = Math.hypot(el.totalRun, el.totalRise);
  const ang = Math.atan2(el.totalRise, el.totalRun);
  for (const sx of [-1, 1]) {
    const s = addBox(g, steel, 0.03, 0.25, len, (sx * (el.width + 0.03)) / 2, el.totalRise / 2 - 0.05, -el.totalRun / 2);
    s.rotation.x = ang;
  }
  // Glass balustrade on one side
  const glass = ctx.material('glass_clear');
  const b = addBox(g, glass, 0.012, 0.9, len, el.width / 2 + 0.05, el.totalRise / 2 + 0.45, -el.totalRun / 2);
  b.rotation.x = ang;
  b.castShadow = false;
  g.position.set(el.position.x, y0 + el.baseOffset, el.position.z);
  g.rotation.y = el.rotation;
  return g;
}

function buildColumn(el: ColumnElement, ctx: BuildContext, y0: number): THREE.Object3D {
  const g = new THREE.Group();
  const mat = ctx.material(el.material);
  if (el.shape === 'round') addCyl(g, mat, el.width / 2, el.width / 2, el.height, 0, el.height / 2, 0, 32);
  else addBox(g, mat, el.width, el.height, el.depth, 0, el.height / 2, 0);
  g.position.set(el.position.x, y0 + el.baseOffset, el.position.z);
  g.rotation.y = el.rotation;
  return g;
}

// ---- Site -----------------------------------------------------------------------
function poolCorners(p: PoolElement, margin: number): Vec2[] {
  const hw = p.width / 2 + margin;
  const hl = p.length / 2 + margin;
  const c = Math.cos(p.rotation);
  const s = Math.sin(p.rotation);
  return [
    [-hw, -hl],
    [hw, -hl],
    [hw, hl],
    [-hw, hl],
  ].map(([x, z]) => ({ x: p.center.x + x * c + z * s, z: p.center.z - x * s + z * c }));
}

function buildTerrain(el: TerrainElement, ctx: BuildContext, y0: number): THREE.Object3D {
  const hw = el.width / 2;
  const hd = el.depth / 2;
  const outer: Vec2[] = [
    { x: el.center.x - hw, z: el.center.z - hd },
    { x: el.center.x + hw, z: el.center.z - hd },
    { x: el.center.x + hw, z: el.center.z + hd },
    { x: el.center.x - hw, z: el.center.z + hd },
  ];
  const shape = polygonShape(outer);
  for (const p of ctx.scene.elements) {
    if (p.type !== 'pool') continue;
    const corners = poolCorners(p, p.copingWidth);
    const inside = corners.every((q) => Math.abs(q.x - el.center.x) < hw && Math.abs(q.z - el.center.z) < hd);
    if (!inside) continue;
    const path = new THREE.Path();
    corners.forEach((q, i) => (i === 0 ? path.moveTo(q.x, -q.z) : path.lineTo(q.x, -q.z)));
    path.closePath();
    shape.holes.push(path);
  }
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, ctx.material(el.material));
  mesh.position.y = y0 + el.elevation;
  mesh.receiveShadow = true;
  const g = new THREE.Group();
  g.add(mesh);
  return g;
}

function buildPool(el: PoolElement, ctx: BuildContext, y0: number): THREE.Object3D {
  const g = new THREE.Group();
  const tile = ctx.material(el.material);
  const coping = ctx.material(el.copingMaterial);
  const water = ctx.material('water');
  const W = el.width;
  const L = el.length;
  const D = el.waterDepth + 0.15;
  const cw = el.copingWidth;
  const t = 0.05;
  // Coping ring (top at 0)
  addBox(g, coping, W + 2 * cw, t, cw, 0, -t / 2, L / 2 + cw / 2);
  addBox(g, coping, W + 2 * cw, t, cw, 0, -t / 2, -L / 2 - cw / 2);
  addBox(g, coping, cw, t, L, W / 2 + cw / 2, -t / 2, 0);
  addBox(g, coping, cw, t, L, -W / 2 - cw / 2, -t / 2, 0);
  // Basin
  const wt = 0.1;
  addBox(g, tile, W, wt, L, 0, -D - wt / 2, 0);
  addBox(g, tile, W + 2 * wt, D, wt, 0, -D / 2 - t / 2, L / 2 + wt / 2);
  addBox(g, tile, W + 2 * wt, D, wt, 0, -D / 2 - t / 2, -L / 2 - wt / 2);
  addBox(g, tile, wt, D, L, W / 2 + wt / 2, -D / 2 - t / 2, 0);
  addBox(g, tile, wt, D, L, -W / 2 - wt / 2, -D / 2 - t / 2, 0);
  const surf = new THREE.Mesh(new THREE.PlaneGeometry(W, L), water);
  surf.rotation.x = -Math.PI / 2;
  surf.position.y = -0.12;
  surf.castShadow = false;
  g.add(surf);
  g.position.set(el.center.x, y0, el.center.z);
  g.rotation.y = el.rotation;
  return g;
}

// ---- Furniture -----------------------------------------------------------------
function buildFurniture(el: FurnitureElement, ctx: BuildContext, y0: number): THREE.Object3D {
  const g = new THREE.Group();
  const m1 = ctx.material(el.material);
  const m2 = ctx.material(el.secondaryMaterial ?? el.material);
  const W = el.width;
  const D = el.depth;
  const H = el.height;
  const B = (m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number) => addBox(g, m, w, h, d, x, y, z);
  const legs = (m: THREE.Material, w: number, d: number, h: number, s = 0.04, inset = 0.06) => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) B(m, s, h, s, sx * (w / 2 - inset), h / 2, sz * (d / 2 - inset));
  };
  switch (el.kind) {
    case 'sofa':
    case 'armchair': {
      const legH = 0.08;
      const seatH = 0.42;
      const armW = Math.min(0.18, W * 0.12);
      legs(m2, W - 0.1, D - 0.1, legH, 0.04);
      B(m1, W, seatH - legH - 0.1, D, 0, legH + (seatH - legH - 0.1) / 2, 0);
      B(m1, W - 2 * armW, H - seatH + 0.05, 0.2, 0, seatH + (H - seatH) / 2 - 0.05, -D / 2 + 0.1);
      B(m1, armW, 0.62 - legH, D, -W / 2 + armW / 2, legH + (0.62 - legH) / 2, 0);
      B(m1, armW, 0.62 - legH, D, W / 2 - armW / 2, legH + (0.62 - legH) / 2, 0);
      const n = el.kind === 'armchair' ? 1 : W > 2.1 ? 3 : 2;
      const cw = (W - 2 * armW) / n;
      for (let i = 0; i < n; i++) B(m1, cw - 0.02, 0.12, D - 0.25, -W / 2 + armW + cw * (i + 0.5), seatH - 0.04, 0.1);
      break;
    }
    case 'coffee_table':
      B(m1, W, 0.04, D, 0, H - 0.02, 0);
      legs(m2, W, D, H - 0.04, 0.03, 0.05);
      break;
    case 'dining_table':
    case 'desk':
      B(m1, W, 0.04, D, 0, H - 0.02, 0);
      if (el.kind === 'desk') {
        B(m2, 0.04, H - 0.04, D - 0.1, -W / 2 + 0.05, (H - 0.04) / 2, 0);
        B(m2, 0.04, H - 0.04, D - 0.1, W / 2 - 0.05, (H - 0.04) / 2, 0);
      } else legs(m2, W, D, H - 0.04, 0.06, 0.09);
      break;
    case 'chair':
      B(m1, W, 0.04, D, 0, 0.45, 0);
      B(m1, W, 0.38, 0.03, 0, 0.45 + 0.21, -D / 2 + 0.015);
      legs(m1, W, D, 0.43, 0.03, 0.03);
      break;
    case 'office_chair':
      B(m1, W * 0.85, 0.08, D * 0.85, 0, 0.48, 0);
      B(m1, W * 0.8, 0.5, 0.06, 0, 0.8, -D * 0.38);
      addCyl(g, m2, 0.025, 0.025, 0.4, 0, 0.24, 0, 12);
      B(m2, W, 0.03, 0.06, 0, 0.05, 0);
      B(m2, 0.06, 0.03, D, 0, 0.05, 0);
      break;
    case 'bed': {
      B(m2, W + 0.04, 0.28, D, 0, 0.2, 0);
      B(m1, W, 0.22, D - 0.06, 0, 0.45, 0.02);
      B(m2, W + 0.04, 0.95, 0.08, 0, 0.475, -D / 2 - 0.04);
      const pillow = ctx.material('paint_white');
      const pw = W > 1.2 ? W / 2 - 0.12 : W - 0.2;
      for (const sx of W > 1.2 ? [-1, 1] : [0]) B(pillow, pw, 0.12, 0.38, sx * (W / 4), 0.62, -D / 2 + 0.3);
      B(ctx.material('fabric_beige'), W + 0.02, 0.05, D * 0.35, 0, 0.58, D * 0.3);
      break;
    }
    case 'nightstand':
    case 'wardrobe':
    case 'tv_unit':
    case 'shelf': {
      if (el.kind === 'shelf') {
        B(m1, 0.03, H, D, -W / 2 + 0.015, H / 2, 0);
        B(m1, 0.03, H, D, W / 2 - 0.015, H / 2, 0);
        const n = Math.max(2, Math.round(H / 0.38));
        for (let i = 0; i <= n; i++) B(m1, W - 0.06, 0.025, D, 0, 0.0125 + ((H - 0.025) * i) / n, 0);
        break;
      }
      B(m1, W, H, D, 0, H / 2, 0);
      if (el.kind === 'wardrobe') {
        const doors = Math.max(2, Math.round(W / 0.6));
        for (let i = 1; i < doors; i++) B(ctx.material('paint_black'), 0.004, H - 0.06, 0.004, -W / 2 + (W * i) / doors, H / 2, D / 2 + 0.002);
        for (let i = 0; i < doors; i++) B(m2, 0.015, 0.3, 0.02, -W / 2 + (W * (i + 0.5)) / doors + (i % 2 ? -1 : 1) * (W / doors / 2 - 0.05), H / 2, D / 2 + 0.012);
      }
      if (el.kind === 'tv_unit') {
        const tw = Math.min(1.6, W * 0.85);
        B(ctx.material('paint_black'), tw, tw * 0.5625, 0.04, 0, H + 0.08 + (tw * 0.5625) / 2, -D / 4);
      }
      break;
    }
    case 'kitchen_counter':
    case 'kitchen_island': {
      B(ctx.material('paint_black'), W - 0.04, 0.1, D - 0.06, 0, 0.05, -0.02);
      B(m1, W, H - 0.14, D - 0.02, 0, 0.1 + (H - 0.14) / 2, -0.01);
      B(m2, W + (el.kind === 'kitchen_island' ? 0.1 : 0), 0.04, D + (el.kind === 'kitchen_island' ? 0.25 : 0.02), 0, H - 0.02, el.kind === 'kitchen_island' ? 0.1 : 0);
      const doors = Math.max(1, Math.round(W / 0.6));
      for (let i = 1; i < doors; i++) B(ctx.material('paint_black'), 0.004, H - 0.2, 0.004, -W / 2 + (W * i) / doors, 0.1 + (H - 0.14) / 2, D / 2 - 0.018);
      if (el.kind === 'kitchen_counter' && W > 1.6) {
        B(ctx.material('steel'), 0.5, 0.02, 0.4, -W / 4, H + 0.001, 0);
        addCyl(g, ctx.material('steel'), 0.015, 0.015, 0.3, -W / 4, H + 0.15, -D / 2 + 0.1, 12);
        B(ctx.material('paint_black'), 0.6, 0.012, 0.5, W / 4, H + 0.006, 0);
      }
      break;
    }
    case 'rug':
      B(m1, W, Math.max(H, 0.008), D, 0, Math.max(H, 0.008) / 2, 0);
      break;
    case 'plant': {
      const r = Math.min(W, D) / 2;
      addCyl(g, m2, r * 0.7, r * 0.55, Math.min(0.45, H * 0.35), 0, Math.min(0.45, H * 0.35) / 2, 0, 20);
      const fol = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), m1);
      fol.scale.set(1, (H * 0.7) / (2 * r), 1);
      fol.position.y = Math.min(0.45, H * 0.35) + H * 0.33;
      g.add(fol);
      break;
    }
    case 'floor_lamp': {
      addCyl(g, m1, 0.14, 0.15, 0.03, 0, 0.015, 0);
      addCyl(g, m1, 0.012, 0.012, H - 0.3, 0, (H - 0.3) / 2, 0, 8);
      addCyl(g, ctx.material(el.secondaryMaterial ?? 'fabric_beige'), 0.12, 0.2, 0.3, 0, H - 0.15, 0, 24);
      break;
    }
    case 'pendant_lamp': {
      // position.y is the height of the shade's bottom edge.
      addCyl(g, m1, 0.003, 0.003, 0.6, 0, 0.3 + H, 0, 6);
      addCyl(g, m1, 0.05, W / 2, H, 0, H / 2, 0, 24);
      break;
    }
    case 'bathtub': {
      const wt = 0.06;
      B(m1, W, 0.06, D, 0, 0.03, 0);
      B(m1, W, H, wt, 0, H / 2, D / 2 - wt / 2);
      B(m1, W, H, wt, 0, H / 2, -D / 2 + wt / 2);
      B(m1, wt, H, D - 2 * wt, W / 2 - wt / 2, H / 2, 0);
      B(m1, wt, H, D - 2 * wt, -W / 2 + wt / 2, H / 2, 0);
      break;
    }
    case 'shower': {
      B(m1, W, 0.05, D, 0, 0.025, 0);
      const gl = addBox(g, m2, W, H - 0.05, 0.01, 0, H / 2, D / 2 - 0.005);
      gl.castShadow = false;
      const gl2 = addBox(g, m2, 0.01, H - 0.05, D, -W / 2 + 0.005, H / 2, 0);
      gl2.castShadow = false;
      addCyl(g, ctx.material('steel'), 0.1, 0.1, 0.01, W / 4, H - 0.1, -D / 4, 20);
      break;
    }
    case 'toilet': {
      B(m1, W * 0.85, 0.4, D * 0.6, 0, 0.2, D * 0.1);
      B(m1, W, 0.06, D * 0.7, 0, 0.42, D * 0.1);
      B(m1, W, 0.4, 0.18, 0, 0.6, -D / 2 + 0.09);
      break;
    }
    case 'vanity': {
      B(m1, W, 0.45, D, 0, H - 0.04 - 0.225, 0);
      B(m2, W, 0.04, D, 0, H - 0.02, 0);
      B(ctx.material('paint_white'), 0.45, 0.12, 0.35, 0, H + 0.06, 0.02);
      B(ctx.material('glass_tinted'), W * 0.9, 0.7, 0.01, 0, H + 0.65, -D / 2 + 0.005);
      break;
    }
    case 'lounger': {
      B(m1, W, 0.25, D * 0.7, 0, 0.125, D * 0.15);
      B(m2, W - 0.04, 0.06, D * 0.7, 0, 0.28, D * 0.15);
      const back = B(m2, W - 0.04, 0.06, D * 0.35, 0, 0.45, -D * 0.32);
      back.rotation.x = -0.6;
      break;
    }
    default:
      B(m1, W, H, D, 0, H / 2, 0);
  }
  g.position.set(el.position.x, y0 + el.position.y, el.position.z);
  g.rotation.y = el.rotation;
  return g;
}
