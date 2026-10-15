'use client';
/**
 * Browser material manager: library definitions → THREE materials.
 * Realistic mode uses procedurally generated, tileable PBR textures (colour,
 * normal and roughness maps) at real-world scale; modelling mode uses clean technical materials.
 */
import * as THREE from 'three';
import { resolveMaterial, type MaterialDef, type TexturePattern } from '@/core/materials/library';
import type { CustomMaterial } from '@/core/schema/scene';

export type RenderStyle = 'technical' | 'realistic';

// ---- deterministic noise ---------------------------------------------------
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNoise(seed: number, size: number) {
  const rnd = mulberry32(seed);
  const grid = new Float32Array(size * size).map(() => rnd());
  const wrap = (i: number, p: number) => ((i % p) + p) % p;
  const at = (x: number, y: number, px: number, py: number) => grid[(wrap(y, py) % size) * size + (wrap(x, px) % size)];
  const smooth = (t: number) => t * t * (3 - 2 * t);
  /** Value noise; the lattice repeats every px × py cells so textures tile seamlessly. */
  return (x: number, y: number, px = size, py = size) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = smooth(x - xi);
    const yf = smooth(y - yi);
    const a = at(xi, yi, px, py);
    const b = at(xi + 1, yi, px, py);
    const c = at(xi, yi + 1, px, py);
    const d = at(xi + 1, yi + 1, px, py);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
}

type Noise = (x: number, y: number, px?: number, py?: number) => number;

/** Fractal noise; px/py are the base lattice periods (the sample frequency) for tiling. */
function fbm(noise: Noise, x: number, y: number, oct = 4, px?: number, py?: number) {
  let v = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < oct; i++) {
    v += amp * noise(x * f, y * f, px ? px * f : undefined, py ? py * f : undefined);
    f *= 2;
    amp *= 0.5;
  }
  return v;
}

function hexToRgb(hex: string): [number, number, number] {
  const c = new THREE.Color(hex);
  return [c.r * 255, c.g * 255, c.b * 255];
}

const mix = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

interface TexturePair {
  color: THREE.CanvasTexture;
  /** Tangent-space normal map derived from the height field (bevels, joints, grain). */
  normal: THREE.CanvasTexture;
  /** Absolute roughness (material roughness × local variation), read from the green channel. */
  rough: THREE.CanvasTexture;
}

const SIZE = 512;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * Generates tileable colour, normal and roughness textures for a pattern.
 * Height (for normals) and roughness are produced alongside colour so joints,
 * bevels and grain both shade and reflect correctly.
 */
function generate(def: MaterialDef): TexturePair | null {
  if (typeof document === 'undefined') return null;
  const pattern: TexturePattern = def.pattern;
  if (pattern === 'none') return null;
  const c1 = hexToRgb(def.color);
  const c2 = hexToRgb(def.color2 ?? def.color);
  const P = SIZE;
  const seed = [...def.id].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7);
  const rnd = mulberry32(seed);
  const n = makeNoise(seed, 64);
  const n2 = makeNoise(seed + 1, 64);
  const n3 = makeNoise(seed + 2, 128);
  const height = new Float32Array(P * P);
  const rough = new Float32Array(P * P);
  const colors = new Uint8ClampedArray(P * P * 4);

  // Planks: 10 rows per tile, each row split into two boards of random length (tileable).
  const plankRows = 10;
  const plankSplit = Array.from({ length: plankRows }, () => [rnd(), 0.35 + rnd() * 0.3] as const);
  const boardTone = Array.from({ length: plankRows * 2 }, () => rnd());
  const knots = Array.from({ length: 4 }, () => ({ u: rnd(), v: rnd(), r: 0.006 + rnd() * 0.01 }));
  const brickRows = 13;
  const brickCols = 4;
  const brickShade = Array.from({ length: brickRows * brickCols }, () => rnd());
  const tileN = pattern === 'tiles' ? 2 : 4;
  const tileShade = Array.from({ length: 64 }, () => rnd());
  const dark = (c: [number, number, number], k: number): [number, number, number] => [c[0] * k, c[1] * k, c[2] * k];

  for (let y = 0; y < P; y++) {
    for (let x = 0; x < P; x++) {
      const u = x / P;
      const v = y / P;
      let col: [number, number, number] = c1;
      let h = 0.5;
      let r = 1;
      switch (pattern) {
        case 'wood': {
          const g = fbm(n, u * 6, v * 64, 3, 6, 64);
          const rings = Math.sin((v * 40 + g * 6) * Math.PI) * 0.5 + 0.5;
          const fibre = n3(u * 4, v * 380, 4, 380);
          col = mix(c1, c2, rings * 0.32 + fbm(n2, u * 16, v * 16, 4, 16, 16) * 0.35);
          col = dark(col, 0.94 + fibre * 0.1);
          h = 0.5 + rings * 0.08 + fibre * 0.05;
          r = 0.8 + rings * 0.25;
          break;
        }
        case 'planks': {
          const row = Math.floor(v * plankRows);
          const fv = (v * plankRows) % 1;
          const [off, split] = plankSplit[row];
          const along = (u + off) % 1;
          const board = along < split ? 0 : 1;
          const fu = board === 0 ? along / split : (along - split) / (1 - split);
          const len = board === 0 ? split : 1 - split;
          const id = row * 2 + board;
          // Micro-bevel at long and short edges (in tile units).
          const edgeV = Math.min(fv, 1 - fv) * (1 / plankRows);
          const edgeU = Math.min(fu, 1 - fu) * len;
          const bevel = sstep(0, 0.006, Math.min(edgeV, edgeU));
          // Soft flame figure plus long fibre streaks running along the board.
          const grainWarp = fbm(n, u * 2 + id * 1.7, fv * 3, 3, 2, 3);
          const grain = Math.sin((fv * 3 + grainWarp * 2.5 + id * 0.37) * Math.PI * 2) * 0.5 + 0.5;
          const streak = fbm(n2, u * 6 + id * 0.61, v * plankRows * 6, 3, 6, plankRows * 6);
          const fibre = n3(u * 3 + id, v * 180, 3, 180);
          let k = 0;
          for (const kn of knots) {
            const du = Math.min(Math.abs(u - kn.u), 1 - Math.abs(u - kn.u)) / (kn.r * 2.2);
            const dv = Math.min(Math.abs(v - kn.v), 1 - Math.abs(v - kn.v)) / kn.r;
            k = Math.max(k, 1 - Math.min(1, Math.hypot(du, dv)));
          }
          col = mix(c1, c2, boardTone[id] * 0.6 + grain * 0.16 + streak * 0.16);
          col = dark(col, (0.94 + fibre * 0.08) * (1 - k * 0.45));
          col = mix(dark(col, 0.55), col, bevel);
          h = 0.15 + bevel * 0.45 + streak * 0.05 + fibre * 0.03 - k * 0.05;
          r = bevel < 0.5 ? 1.3 : 0.8 + streak * 0.3 + boardTone[id] * 0.15;
          break;
        }
        case 'concrete': {
          const f = fbm(n, u * 8, v * 8, 5, 8, 8);
          const pores = n2(u * 180, v * 180, 180, 180) > 0.93 ? 1 : 0;
          const fine = n3(u * 300, v * 300, 300, 300);
          col = mix(c1, c2, f * 0.9);
          col = mix(col, [60, 60, 58], pores * 0.35);
          col = dark(col, 0.96 + fine * 0.07);
          h = 0.5 + f * 0.2 + fine * 0.08 - pores * 0.35;
          r = 0.85 + f * 0.25 + pores * 0.2;
          break;
        }
        case 'plaster': {
          // Broad trowel waves plus fine sand grain.
          const sweep = fbm(n, u * 3 + fbm(n2, u * 2, v * 2, 2, 2, 2), v * 5, 3, 3, 5);
          const sand = n3(u * 420, v * 420, 420, 420);
          col = mix(c1, c2, sweep * 0.55 + sand * 0.15);
          h = 0.5 + sweep * 0.22 + sand * 0.18;
          r = 0.9 + sand * 0.15;
          break;
        }
        case 'brick': {
          const row = Math.floor(v * brickRows);
          const offset = (row % 2) * 0.5;
          const colIdx = Math.floor((u * brickCols + offset) % brickCols);
          const fu = (u * brickCols + offset) % 1;
          const fv = (v * brickRows) % 1;
          // Irregular brick edges.
          const jitter = (fbm(n2, u * 60, v * 60, 2, 60, 60) - 0.5) * 0.04;
          const edge = Math.min(fv - 0.12 - jitter, 1 - fv - jitter * 0.5, (fu - 0.04 - jitter) * 3, (1 - fu - jitter) * 3);
          const inBrick = sstep(0, 0.05, edge);
          const shade = brickShade[(row * brickCols + colIdx) % brickShade.length];
          const f = fbm(n, u * 30, v * 30, 3, 30, 30);
          const sand = n3(u * 400, v * 400, 400, 400);
          const brick = mix(c1, dark(c1, 0.72), shade * 0.6 + f * 0.25);
          const mortar = mix(c2, [120, 116, 110], f * 0.3);
          col = mix(mortar, dark(brick, 0.95 + sand * 0.1), inBrick);
          h = 0.12 + inBrick * (0.5 + f * 0.12) + sand * 0.05;
          r = inBrick > 0.5 ? 0.9 + f * 0.2 : 1.2;
          break;
        }
        case 'marble': {
          const t = fbm(n, u * 4, v * 4, 6, 4, 4);
          const vein = Math.abs(Math.sin((u * 3 + v * 2 + t * 5) * Math.PI));
          const veinT = Math.pow(1 - vein, 10);
          col = mix(c1, c2, veinT * 0.85 + fbm(n2, u * 10, v * 10, 4, 10, 10) * 0.08);
          h = 0.5 + veinT * 0.01;
          r = 0.85 + veinT * 0.4;
          break;
        }
        case 'stone': {
          const f = fbm(n, u * 10, v * 10, 5, 10, 10);
          const cells = fbm(n2, u * 4, v * 4, 2, 4, 4);
          const grit = n3(u * 350, v * 350, 350, 350);
          col = mix(c1, c2, f * 0.6 + (cells > 0.55 ? 0.2 : 0));
          col = dark(col, 0.95 + grit * 0.1);
          h = 0.4 + f * 0.3 + grit * 0.08;
          r = 0.85 + f * 0.3;
          break;
        }
        case 'tiles': {
          const ti = Math.floor(u * tileN);
          const tj = Math.floor(v * tileN);
          const fu = (u * tileN) % 1;
          const fv = (v * tileN) % 1;
          const edge = Math.min(fu, 1 - fu, fv, 1 - fv) / tileN;
          const face = sstep(0.004, 0.009, edge);
          const f = fbm(n, u * 20, v * 20, 3, 20, 20);
          const tile = mix(c1, c2, tileShade[(ti * 7 + tj) % 64] * 0.18 + f * 0.12);
          const grout = mix(c2, [180, 178, 172], 0.4);
          col = mix(grout, tile, face);
          h = 0.15 + face * 0.5;
          // Glazed faces are glossy, grout is matte.
          r = face > 0.5 ? 0.6 + f * 0.2 : 1.6;
          break;
        }
        case 'grass': {
          const f = fbm(n, u * 12, v * 12, 5, 12, 12);
          const blades = n2(u * 220, v * 220, 220, 220);
          const fine = n3(u * 500, v * 500, 500, 500);
          col = mix(c1, c2, f * 0.8);
          col = mix(col, [140, 160, 80], blades > 0.8 ? 0.25 : 0);
          col = dark(col, 0.85 + fine * 0.25);
          h = 0.35 + blades * 0.3 + fine * 0.2;
          r = 1;
          break;
        }
        case 'gravel': {
          const g = n(u * 120, v * 120, 120, 120);
          const g2 = n2(u * 60, v * 60, 60, 60);
          col = mix(c1, c2, g * 0.7 + g2 * 0.3);
          if (g > 0.8) col = mix(col, [230, 228, 220], 0.3);
          h = g;
          r = 0.9 + g2 * 0.2;
          break;
        }
        case 'water': {
          const f = fbm(n, u * 6, v * 6, 4, 6, 6);
          col = mix(c1, [c1[0] * 1.2, c1[1] * 1.15, c1[2] * 1.1], f * 0.6);
          h = f;
          break;
        }
        case 'metal': {
          const brushed = n(u * 2, v * 400, 2, 400) * 0.5 + n2(u * 4, v * 200, 4, 200) * 0.5;
          const seam = def.id === 'metal_dark_grey' && (u * 4) % 1 < 0.02;
          col = mix(c1, [Math.min(255, c1[0] * 1.25), Math.min(255, c1[1] * 1.25), Math.min(255, c1[2] * 1.25)], brushed * 0.35);
          if (seam) col = mix(col, [20, 20, 22], 0.6);
          h = seam ? 0.2 : 0.5 + brushed * 0.04;
          r = 0.75 + brushed * 0.5;
          break;
        }
        case 'fabric': {
          const weave = Math.sin(u * Math.PI * 2 * 72) * Math.sin(v * Math.PI * 2 * 72) * 0.5 + 0.5;
          const f = fbm(n, u * 20, v * 20, 3, 20, 20);
          col = mix(c1, c2, weave * 0.35 + f * 0.25);
          h = 0.5 + weave * 0.25;
          r = 1;
          break;
        }
      }
      const idx = y * P + x;
      height[idx] = h;
      rough[idx] = r;
      colors[idx * 4] = col[0];
      colors[idx * 4 + 1] = col[1];
      colors[idx * 4 + 2] = col[2];
      colors[idx * 4 + 3] = 255;
    }
  }

  // Normal map from the height field (Sobel, wrapping so it tiles).
  const strength = { planks: 6, tiles: 6, brick: 5, concrete: 2.5, plaster: 2.2, stone: 3, wood: 1.6, grass: 2.5, gravel: 3, metal: 0.8, fabric: 1.5, marble: 0.4, water: 1.5 }[pattern as string] ?? 2;
  const H = (xx: number, yy: number) => height[((yy + P) % P) * P + ((xx + P) % P)];
  const normals = new Uint8ClampedArray(P * P * 4);
  const roughPx = new Uint8ClampedArray(P * P * 4);
  for (let y = 0; y < P; y++) {
    for (let x = 0; x < P; x++) {
      const dx = H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1) - H(x - 1, y - 1) - 2 * H(x - 1, y) - H(x - 1, y + 1);
      const dy = H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1) - H(x - 1, y - 1) - 2 * H(x, y - 1) - H(x + 1, y - 1);
      let nx = -dx * strength;
      let ny = dy * strength;
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      const i = (y * P + x) * 4;
      normals[i] = (nx * 0.5 + 0.5) * 255;
      normals[i + 1] = (ny * 0.5 + 0.5) * 255;
      normals[i + 2] = (nz * 0.5 + 0.5) * 255;
      normals[i + 3] = 255;
      const rv = clamp01(def.roughness * rough[y * P + x]) * 255;
      roughPx[i] = roughPx[i + 1] = roughPx[i + 2] = rv;
      roughPx[i + 3] = 255;
    }
  }

  const canvasOf = (data: Uint8ClampedArray) => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = P;
    cv.getContext('2d')!.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, P, P), 0, 0);
    return cv;
  };
  const color = new THREE.CanvasTexture(canvasOf(colors));
  color.colorSpace = THREE.SRGBColorSpace;
  const normal = new THREE.CanvasTexture(canvasOf(normals));
  const roughTex = new THREE.CanvasTexture(canvasOf(roughPx));
  for (const t of [color, normal, roughTex]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1 / def.tileSize, 1 / def.tileSize);
    t.anisotropy = 8;
    t.needsUpdate = true;
  }
  return { color, normal, rough: roughTex };
}

const textureCache = new Map<string, TexturePair | null>();
function texturesFor(def: MaterialDef): TexturePair | null {
  const key = `${def.pattern}:${def.color}:${def.color2 ?? ''}:${def.tileSize}:${def.id}`;
  if (!textureCache.has(key)) textureCache.set(key, generate(def));
  return textureCache.get(key) ?? null;
}

/** Lightened, untextured colour for technical (modelling) display. */
function technicalColor(def: MaterialDef): THREE.Color {
  const c = new THREE.Color(def.color);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  return new THREE.Color().setHSL(hsl.h, hsl.s * 0.55, 0.35 + hsl.l * 0.55);
}

export class MaterialManager {
  private cache = new Map<string, THREE.Material>();
  constructor(
    public style: RenderStyle,
    private custom: CustomMaterial[] = [],
    /**
     * 'transmission' (refractive glass/water, an extra render pass) only for still
     * presentation views; 'transparent' everywhere else: stable when the camera is
     * close to or moving past glass, and much cheaper.
     */
    private glass: 'transmission' | 'transparent' = 'transparent',
  ) {}

  get = (ref: string): THREE.Material => {
    const customKey = this.custom.find((c) => c.id === ref);
    const key = `${ref}:${customKey ? JSON.stringify(customKey) : ''}`;
    let m = this.cache.get(key);
    if (m) return m;
    m = this.create(ref);
    this.cache.set(key, m);
    return m;
  };

  private create(ref: string): THREE.Material {
    if (ref === '__room') {
      return new THREE.MeshBasicMaterial({ color: '#cdab74', transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
    }
    const def = resolveMaterial(ref, this.custom);
    const isGlass = def.category === 'glass';
    if (this.style === 'technical') {
      if (isGlass) return new THREE.MeshStandardMaterial({ name: def.id, color: '#9cc6e6', transparent: true, opacity: 0.35, roughness: 0.1, metalness: 0, depthWrite: false });
      if (def.id === 'water') return new THREE.MeshStandardMaterial({ name: def.id, color: '#7fc4d8', transparent: true, opacity: 0.6, roughness: 0.2, depthWrite: false });
      return new THREE.MeshStandardMaterial({ name: def.id, color: technicalColor(def), roughness: 0.92, metalness: 0.0 });
    }
    if (isGlass && this.glass === 'transparent') {
      return new THREE.MeshPhysicalMaterial({
        name: def.id,
        color: def.color,
        roughness: def.id.includes('frosted') ? def.roughness : Math.min(def.roughness, 0.08),
        metalness: 0,
        transparent: true,
        opacity: def.id.includes('frosted') ? 0.6 : 0.22,
        envMapIntensity: 1.3,
        specularIntensity: 1,
        depthWrite: false,
      });
    }
    if (def.id === 'water' && this.glass === 'transparent') {
      const tex = texturesFor(def);
      return new THREE.MeshStandardMaterial({
        name: def.id,
        color: def.color,
        roughness: 0.05,
        metalness: 0.1,
        transparent: true,
        opacity: 0.82,
        normalMap: tex?.normal ?? null,
        normalScale: new THREE.Vector2(0.35, 0.35),
        envMapIntensity: 1.4,
        depthWrite: false,
      });
    }
    if (isGlass) {
      return new THREE.MeshPhysicalMaterial({
        name: def.id,
        color: def.color,
        roughness: def.roughness,
        metalness: 0,
        transmission: def.transmission ?? 0.9,
        thickness: 0.01,
        ior: def.ior ?? 1.5,
        transparent: true,
        opacity: 1,
        envMapIntensity: 1.2,
        specularIntensity: 1,
        depthWrite: false,
      });
    }
    if (def.id === 'water') {
      const tex = texturesFor(def);
      return new THREE.MeshPhysicalMaterial({
        name: def.id,
        color: def.color,
        roughness: 0.04,
        metalness: 0,
        transmission: 0.55,
        transparent: true,
        opacity: 0.92,
        ior: 1.33,
        normalMap: tex?.normal ?? null,
        normalScale: new THREE.Vector2(0.35, 0.35),
        envMapIntensity: 1.4,
      });
    }
    const tex = texturesFor(def);
    const m = new THREE.MeshStandardMaterial({
      name: def.id,
      color: tex ? '#ffffff' : def.color,
      map: tex?.color ?? null,
      normalMap: tex?.normal ?? null,
      // The roughness map already holds the absolute value (base × local variation).
      roughnessMap: tex?.rough ?? null,
      roughness: tex ? 1 : def.roughness,
      metalness: def.metalness,
      envMapIntensity: def.category === 'metal' ? 1.1 : 0.85,
    });
    return m;
  }

  dispose() {
    for (const m of this.cache.values()) m.dispose();
    this.cache.clear();
  }
}

/** CSS swatch for UI previews. */
export function swatchStyle(def: MaterialDef): React.CSSProperties {
  if (def.category === 'glass') return { background: `linear-gradient(135deg, ${def.color}55, ${def.color}aa)` };
  const c2 = def.color2 ?? def.color;
  switch (def.pattern) {
    case 'brick':
      return { background: `repeating-linear-gradient(0deg, ${c2} 0 2px, ${def.color} 2px 9px)` };
    case 'planks':
    case 'wood':
      return { background: `repeating-linear-gradient(90deg, ${def.color} 0 6px, ${c2} 6px 8px)` };
    case 'tiles':
      return { background: `linear-gradient(90deg, ${c2} 1px, transparent 1px) 0 0/10px 10px, linear-gradient(0deg, ${c2} 1px, ${def.color} 1px) 0 0/10px 10px` };
    case 'marble':
      return { background: `linear-gradient(120deg, ${def.color} 40%, ${c2} 45%, ${def.color} 52%)` };
    case 'metal':
      return { background: `linear-gradient(135deg, ${def.color}, #ffffff33 50%, ${def.color})` };
    default:
      return { background: `radial-gradient(circle at 30% 30%, ${def.color}, ${c2})` };
  }
}
