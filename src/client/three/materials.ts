'use client';
/**
 * Browser material manager: library definitions → THREE materials.
 * Realistic mode uses procedurally generated, tileable PBR textures (colour +
 * bump) at real-world scale; modelling mode uses clean technical materials.
 */
import * as THREE from 'three';
import { resolveMaterial, type MaterialDef, type TexturePattern } from '@/core/materials/library';
import type { CustomMaterial } from '@/core/schema/scene';

export type RenderStyle = 'technical' | 'realistic' | 'pathtrace';

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
  const at = (x: number, y: number) => grid[((y % size) + size) % size * size + (((x % size) + size) % size)];
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = smooth(x - xi);
    const yf = smooth(y - yi);
    const a = at(xi, yi);
    const b = at(xi + 1, yi);
    const c = at(xi, yi + 1);
    const d = at(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
}

function fbm(noise: (x: number, y: number) => number, x: number, y: number, oct = 4) {
  let v = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < oct; i++) {
    v += amp * noise(x * f, y * f);
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
  bump: THREE.CanvasTexture;
}

const SIZE = 512;

/** Generates a tileable colour + height texture pair for a pattern. */
function generate(def: MaterialDef): TexturePair | null {
  if (typeof document === 'undefined') return null;
  const pattern: TexturePattern = def.pattern;
  if (pattern === 'none') return null;
  const c1 = hexToRgb(def.color);
  const c2 = hexToRgb(def.color2 ?? def.color);
  const colorCanvas = document.createElement('canvas');
  const bumpCanvas = document.createElement('canvas');
  colorCanvas.width = colorCanvas.height = bumpCanvas.width = bumpCanvas.height = SIZE;
  const cctx = colorCanvas.getContext('2d')!;
  const bctx = bumpCanvas.getContext('2d')!;
  const cimg = cctx.createImageData(SIZE, SIZE);
  const bimg = bctx.createImageData(SIZE, SIZE);
  const seed = [...def.id].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7);
  const rnd = mulberry32(seed);
  const n = makeNoise(seed, 64);
  const n2 = makeNoise(seed + 1, 64);
  const P = SIZE;

  // Per-pattern cell layout helpers
  const brickRows = 13;
  const brickCols = 4;
  const plankRows = 6;
  const plankSegs = 2;
  const plankShade = Array.from({ length: plankRows * plankSegs * 2 }, () => rnd());
  const brickShade = Array.from({ length: brickRows * brickCols * 2 }, () => rnd());
  const tileN = pattern === 'tiles' ? 2 : 4;
  const tileShade = Array.from({ length: 64 }, () => rnd());

  for (let y = 0; y < P; y++) {
    for (let x = 0; x < P; x++) {
      const u = x / P;
      const v = y / P;
      let col: [number, number, number] = c1;
      let h = 0.5;
      switch (pattern) {
        case 'wood': {
          const g = fbm(n, u * 6, v * 64, 3);
          const rings = Math.sin((v * 40 + g * 6) * Math.PI) * 0.5 + 0.5;
          col = mix(c1, c2, rings * 0.6 + fbm(n2, u * 16, v * 16) * 0.3);
          h = 0.5 + rings * 0.1;
          break;
        }
        case 'planks': {
          const row = Math.floor(v * plankRows);
          const offset = (row % 2) * 0.5;
          const seg = Math.floor((u + offset) * plankSegs) % plankSegs;
          const id = row * plankSegs + seg;
          const fu = ((u + offset) * plankSegs) % 1;
          const fv = (v * plankRows) % 1;
          const seam = fv < 0.03 || fu < 0.006;
          const grain = Math.sin((fv * 8 + fbm(n, u * 3 + id, fv * 20, 3) * 4) * Math.PI) * 0.5 + 0.5;
          col = mix(c1, c2, plankShade[id] * 0.55 + grain * 0.35);
          if (seam) col = mix(col, [20, 14, 10], 0.55);
          h = seam ? 0.1 : 0.55 + grain * 0.06;
          break;
        }
        case 'concrete': {
          const f = fbm(n, u * 8, v * 8, 5);
          const pores = n2(u * 180, v * 180) > 0.93 ? 0.35 : 0;
          col = mix(c1, c2, f * 0.9);
          col = mix(col, [60, 60, 58], pores);
          h = 0.5 + f * 0.25 - pores * 0.4;
          break;
        }
        case 'plaster': {
          const f = fbm(n, u * 14, v * 14, 5);
          col = mix(c1, c2, f * 0.7);
          h = 0.5 + f * 0.3;
          break;
        }
        case 'brick': {
          const row = Math.floor(v * brickRows);
          const offset = (row % 2) * 0.5;
          const colIdx = Math.floor((u * brickCols + offset) % brickCols);
          const fu = (u * brickCols + offset) % 1;
          const fv = (v * brickRows) % 1;
          const mortar = fv < 0.13 || fu < 0.045;
          const shade = brickShade[(row * brickCols + colIdx) % brickShade.length];
          const f = fbm(n, u * 30, v * 30, 3);
          col = mortar ? mix(c2, [120, 116, 110], f * 0.3) : mix(c1, [c1[0] * 0.75, c1[1] * 0.75, c1[2] * 0.75], shade * 0.6 + f * 0.25);
          h = mortar ? 0.15 : 0.6 + f * 0.15;
          break;
        }
        case 'marble': {
          const t = fbm(n, u * 4, v * 4, 6);
          const vein = Math.abs(Math.sin((u * 3 + v * 2 + t * 5) * Math.PI));
          const veinT = Math.pow(1 - vein, 10);
          col = mix(c1, c2, veinT * 0.85 + fbm(n2, u * 10, v * 10) * 0.08);
          h = 0.5;
          break;
        }
        case 'stone': {
          const f = fbm(n, u * 10, v * 10, 5);
          const cells = fbm(n2, u * 4, v * 4, 2);
          col = mix(c1, c2, f * 0.6 + (cells > 0.55 ? 0.2 : 0));
          h = 0.4 + f * 0.3;
          break;
        }
        case 'tiles': {
          const ti = Math.floor(u * tileN);
          const tj = Math.floor(v * tileN);
          const fu = (u * tileN) % 1;
          const fv = (v * tileN) % 1;
          const grout = fu < 0.015 || fv < 0.015 || fu > 0.985 || fv > 0.985;
          const f = fbm(n, u * 20, v * 20, 3);
          col = grout ? mix(c2, [180, 178, 172], 0.4) : mix(c1, c2, tileShade[(ti * 7 + tj) % 64] * 0.18 + f * 0.12);
          h = grout ? 0.2 : 0.6;
          break;
        }
        case 'grass': {
          const f = fbm(n, u * 12, v * 12, 5);
          const blades = n2(u * 220, v * 220);
          col = mix(c1, c2, f * 0.8);
          col = mix(col, [140, 160, 80], blades > 0.8 ? 0.25 : 0);
          h = 0.4 + blades * 0.3;
          break;
        }
        case 'gravel': {
          const g = n(u * 120, v * 120);
          const g2 = n2(u * 60, v * 60);
          col = mix(c1, c2, g * 0.7 + g2 * 0.3);
          if (g > 0.8) col = mix(col, [230, 228, 220], 0.3);
          h = g;
          break;
        }
        case 'water': {
          const f = fbm(n, u * 6, v * 6, 4);
          col = mix(c1, [c1[0] * 1.2, c1[1] * 1.15, c1[2] * 1.1], f * 0.6);
          h = f;
          break;
        }
        case 'metal': {
          const brushed = n(u * 2, v * 400) * 0.5 + n2(u * 4, v * 200) * 0.5;
          const seam = (u * 4) % 1 < 0.02;
          col = mix(c1, [Math.min(255, c1[0] * 1.25), Math.min(255, c1[1] * 1.25), Math.min(255, c1[2] * 1.25)], brushed * 0.35);
          if (seam && def.id === 'metal_dark_grey') col = mix(col, [20, 20, 22], 0.6);
          h = seam && def.id === 'metal_dark_grey' ? 0.9 : 0.5 + brushed * 0.05;
          break;
        }
        case 'fabric': {
          const weave = (Math.sin(u * P * 0.9) * Math.sin(v * P * 0.9)) * 0.5 + 0.5;
          const f = fbm(n, u * 20, v * 20, 3);
          col = mix(c1, c2, weave * 0.35 + f * 0.25);
          h = 0.5 + weave * 0.2;
          break;
        }
      }
      const i = (y * P + x) * 4;
      cimg.data[i] = col[0];
      cimg.data[i + 1] = col[1];
      cimg.data[i + 2] = col[2];
      cimg.data[i + 3] = 255;
      const hv = Math.max(0, Math.min(255, h * 255));
      bimg.data[i] = bimg.data[i + 1] = bimg.data[i + 2] = hv;
      bimg.data[i + 3] = 255;
    }
  }
  cctx.putImageData(cimg, 0, 0);
  bctx.putImageData(bimg, 0, 0);
  const color = new THREE.CanvasTexture(colorCanvas);
  color.colorSpace = THREE.SRGBColorSpace;
  const bump = new THREE.CanvasTexture(bumpCanvas);
  for (const t of [color, bump]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1 / def.tileSize, 1 / def.tileSize);
    t.anisotropy = 8;
    t.needsUpdate = true;
  }
  return { color, bump };
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
      return new THREE.MeshBasicMaterial({ color: '#e2b86b', transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
    }
    const def = resolveMaterial(ref, this.custom);
    const isGlass = def.category === 'glass';
    if (this.style === 'technical') {
      if (isGlass) return new THREE.MeshStandardMaterial({ name: def.id, color: '#9cc6e6', transparent: true, opacity: 0.35, roughness: 0.1, metalness: 0, depthWrite: false });
      if (def.id === 'water') return new THREE.MeshStandardMaterial({ name: def.id, color: '#7fc4d8', transparent: true, opacity: 0.6, roughness: 0.2, depthWrite: false });
      return new THREE.MeshStandardMaterial({ name: def.id, color: technicalColor(def), roughness: 0.92, metalness: 0.0 });
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
      const tex = this.style === 'pathtrace' ? null : texturesFor(def);
      return new THREE.MeshPhysicalMaterial({
        name: def.id,
        color: def.color,
        roughness: 0.04,
        metalness: 0,
        transmission: 0.55,
        transparent: true,
        opacity: 0.92,
        ior: 1.33,
        bumpMap: tex?.bump ?? null,
        bumpScale: 0.4,
        envMapIntensity: 1.4,
      });
    }
    // Path tracing uses physically based colours without procedural textures.
    const tex = this.style === 'pathtrace' ? null : texturesFor(def);
    const m = new THREE.MeshStandardMaterial({
      name: def.id,
      color: tex ? '#ffffff' : def.color,
      map: tex?.color ?? null,
      bumpMap: tex?.bump ?? null,
      bumpScale: def.pattern === 'brick' || def.pattern === 'tiles' || def.pattern === 'planks' ? 1.6 : 0.5,
      roughness: def.roughness,
      metalness: def.metalness,
      envMapIntensity: def.category === 'metal' ? 1.1 : 0.85,
    });
    if (def.category === 'landscape' && def.id === 'foliage') m.flatShading = true;
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
