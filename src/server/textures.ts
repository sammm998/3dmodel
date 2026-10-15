/**
 * Texture service: fetches photographed PBR maps from Poly Haven's public API
 * (CC0 assets) server-side, caches them on disk and serves them same-origin, so
 * the browser needs no cross-origin access and each file is downloaded once.
 * Only the assets listed in PHOTO_MATERIALS are served.
 *
 * Poly Haven API terms: requests carry a unique User-Agent, and the interface
 * shows a "Powered by Poly Haven" credit while these textures are in use.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { dataDir } from './storage';
import { PHOTO_ASSETS, type PhotoMap, type PhotoResolution } from '@/core/materials/photo';

const API = 'https://api.polyhaven.com';
const USER_AGENT = 'AI3DStudio/1.0 (architectural modeller; texture cache)';
const MAP_KEYS: Record<PhotoMap, string> = { diff: 'Diffuse', nor: 'nor_gl', rough: 'Rough' };

type Fetch = typeof fetch;
let fetchImpl: Fetch = (...a) => fetch(...a);
/** Tests replace the network. */
export function setTextureFetch(f: Fetch | null) {
  fetchImpl = f ?? ((...a) => fetch(...a));
  offlineUntil = 0;
  filesCache.clear();
  infoCache.clear();
}

const filesCache = new Map<string, Promise<Record<string, Record<string, Record<string, { url: string }>>>>>();
const infoCache = new Map<string, Promise<{ width: number; height: number }>>();
const inflight = new Map<string, Promise<Buffer>>();

function cacheDir() {
  return process.env.TEXTURE_CACHE_DIR ?? path.join(dataDir(), 'texture-cache');
}

async function getJson(url: string) {
  const r = await fetchImpl(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' } });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}

/** When Poly Haven cannot be reached, stop asking for a few minutes. */
let offlineUntil = 0;

function files(asset: string) {
  if (Date.now() < offlineUntil) return Promise.reject(Object.assign(new Error('texture source unavailable'), { status: 503 }));
  let p = filesCache.get(asset);
  if (!p) {
    p = getJson(`${API}/files/${asset}`);
    p.catch((e: Error) => {
      filesCache.delete(asset);
      // Network failures (not a 404 for one asset) pause all requests briefly.
      if (!/→ 4\d\d$/.test(e.message)) offlineUntil = Date.now() + 5 * 60_000;
    });
    filesCache.set(asset, p);
  }
  return p;
}

export function isPhotoAsset(asset: string) {
  return PHOTO_ASSETS.has(asset);
}

/** Real-world size of one tile of the texture, in metres (from the asset's dimensions). */
export function textureInfo(asset: string): Promise<{ width: number; height: number }> {
  let p = infoCache.get(asset);
  if (!p) {
    p = getJson(`${API}/info/${asset}`)
      .then((info: { dimensions?: number[] }) => {
        const [w, h] = info.dimensions ?? [];
        const ok = (v: unknown) => typeof v === 'number' && v > 50 && v < 50_000;
        return { width: ok(w) ? (w as number) / 1000 : 2, height: ok(h) ? (h as number) / 1000 : ok(w) ? (w as number) / 1000 : 2 };
      })
      .catch(() => ({ width: 2, height: 2 }));
    infoCache.set(asset, p);
  }
  return p;
}

/** JPEG bytes of one map, from the disk cache or Poly Haven. */
export async function textureFile(asset: string, map: PhotoMap, res: PhotoResolution): Promise<Buffer> {
  if (!isPhotoAsset(asset)) throw Object.assign(new Error('unknown texture'), { status: 404 });
  const file = path.join(cacheDir(), `${asset}_${map}_${res}.jpg`);
  try {
    return await fs.readFile(file);
  } catch {
    // not cached yet
  }
  const key = file;
  let p = inflight.get(key);
  if (!p) {
    p = (async () => {
      const tree = await files(asset);
      const url = tree[MAP_KEYS[map]]?.[res]?.jpg?.url;
      if (!url || !/^https:\/\/[a-z0-9.-]*polyhaven\.(org|com)\//.test(url)) throw Object.assign(new Error('map not available'), { status: 404 });
      const r = await fetchImpl(url, { headers: { 'user-agent': USER_AGENT } });
      if (!r.ok) throw Object.assign(new Error(`download failed (${r.status})`), { status: 502 });
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 1000 || buf[0] !== 0xff || buf[1] !== 0xd8) throw Object.assign(new Error('not a JPEG'), { status: 502 });
      await fs.mkdir(path.dirname(file), { recursive: true }).catch(() => {});
      await fs.writeFile(file, buf).catch(() => {});
      return buf;
    })();
    inflight.set(key, p);
    p.finally(() => inflight.delete(key)).catch(() => {});
  }
  return p;
}
