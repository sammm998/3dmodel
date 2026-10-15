'use client';
/**
 * Photographed environments (HDRIs, CC0, bundled via @pmndrs/assets) as image
 * based light: glass and glossy surfaces reflect real trees, buildings and clouds,
 * and ambient light gets the colour of a real sky and ground.
 *
 * Each HDRI is turned so that its own sun stands where the scene's sun is, its sun
 * peak is clamped (the scene's directional light already is the sun; a second,
 * baked-in sun would double highlights and shading), and its brightness is
 * normalised so every environment lights the scene at the same level.
 */
import * as THREE from 'three';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';

export type HdriName = 'park' | 'sunset' | 'city' | 'night';

const SOURCES: Record<HdriName, () => Promise<{ default: string }>> = {
  park: () => import('@pmndrs/assets/hdri/park.exr.js'),
  sunset: () => import('@pmndrs/assets/hdri/sunset.exr.js'),
  city: () => import('@pmndrs/assets/hdri/city.exr.js'),
  night: () => import('@pmndrs/assets/hdri/night.exr.js'),
};

const raw = new Map<HdriName, Promise<{ data: Float32Array; width: number; height: number }>>();

function loadRaw(name: HdriName) {
  let p = raw.get(name);
  if (!p) {
    p = SOURCES[name]().then(async (m) => {
      const loader = new EXRLoader();
      loader.setDataType(THREE.FloatType);
      const tex = await loader.loadAsync(m.default);
      const img = tex.image as { data: Float32Array; width: number; height: number };
      const out = { data: new Float32Array(img.data), width: img.width, height: img.height };
      tex.dispose();
      return out;
    });
    p.catch(() => raw.delete(name));
    raw.set(name, p);
  }
  return p;
}

const lum = (d: Float32Array, i: number) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];

/** Equirect texture (linear float) aligned to the sun, clamped and normalised. */
export async function preparedHdri(name: HdriName, sunDir: THREE.Vector3, opts: { mean?: number; clamp?: number } = {}): Promise<THREE.DataTexture> {
  const { data, width: W, height: H } = await loadRaw(name);
  const ch = data.length / (W * H);
  // The sun: the brightest pixel.
  let best = 0;
  let bestX = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const l = lum(data, (y * W + x) * ch);
      if (l > best) {
        best = l;
        bestX = x;
      }
    }
  // three.js equirect lookup: u = atan2(dir.z, dir.x) / 2π + 0.5.
  const uSun = (bestX + 0.5) / W;
  const uTarget = Math.atan2(sunDir.z, sunDir.x) / (Math.PI * 2) + 0.5;
  const shift = Math.round((uTarget - uSun) * W);
  const out = new Float32Array(W * H * 4);
  let sum = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const si = (y * W + x) * ch;
      const di = (y * W + ((((x + shift) % W) + W) % W)) * 4;
      out[di] = data[si];
      out[di + 1] = data[si + 1];
      out[di + 2] = data[si + 2];
      out[di + 3] = 1;
    }
  // Median-ish level for the clamp: average of everything below the 98th percentile.
  const lums: number[] = [];
  for (let i = 0; i < out.length; i += 4 * 7) lums.push(lum(out, i));
  lums.sort((a, b) => a - b);
  const p98 = lums[Math.floor(lums.length * 0.98)] || 1;
  const cap = p98 * (opts.clamp ?? 3);
  for (let i = 0; i < out.length; i += 4) {
    const l = lum(out, i);
    if (l > cap) {
      const k = cap / l;
      out[i] *= k;
      out[i + 1] *= k;
      out[i + 2] *= k;
    }
    sum += Math.min(l, cap);
  }
  const mean = sum / (W * H);
  const k = (opts.mean ?? 0.8) / Math.max(mean, 1e-4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] *= k;
    out[i + 1] *= k;
    out[i + 2] *= k;
  }
  const tex = new THREE.DataTexture(out, W, H, THREE.RGBAFormat, THREE.FloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}
