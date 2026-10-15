import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTextureFetch, textureFile, textureInfo } from '@/server/textures';
import { PHOTO_ASSETS, PHOTO_MATERIALS, photoTint } from '@/core/materials/photo';
import { MATERIALS } from '@/core/materials/library';

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(4000, 7)]);

describe('texture service', () => {
  let dir: string;
  let calls: string[];
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tex-'));
    process.env.TEXTURE_CACHE_DIR = dir;
    calls = [];
    setTextureFetch(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      expect((init?.headers as Record<string, string>)['user-agent']).toMatch(/AI3DStudio/);
      if (url === 'https://api.polyhaven.com/files/wood_floor') {
        return new Response(JSON.stringify({ Diffuse: { '1k': { jpg: { url: 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/wood_floor/wood_floor_diff_1k.jpg' } } }, nor_gl: { '1k': { jpg: { url: 'https://dl.polyhaven.org/n.jpg' } } }, Rough: {} }));
      }
      if (url === 'https://api.polyhaven.com/info/wood_floor') return new Response(JSON.stringify({ name: 'Wood Floor', dimensions: [2000, 1500] }));
      if (url.startsWith('https://dl.polyhaven.org/')) return new Response(new Uint8Array(jpeg));
      return new Response('nope', { status: 404 });
    });
  });
  afterEach(() => {
    setTextureFetch(null);
    delete process.env.TEXTURE_CACHE_DIR;
  });

  it('downloads a map once, then serves it from the disk cache', async () => {
    const a = await textureFile('wood_floor', 'diff', '1k');
    expect(a.equals(jpeg)).toBe(true);
    expect(fs.existsSync(path.join(dir, 'wood_floor_diff_1k.jpg'))).toBe(true);
    const n = calls.length;
    const b = await textureFile('wood_floor', 'diff', '1k');
    expect(b.equals(jpeg)).toBe(true);
    expect(calls.length).toBe(n);
  });

  it('reports the tile size in metres', async () => {
    expect(await textureInfo('wood_floor')).toEqual({ width: 2, height: 1.5 });
  });

  it('refuses assets outside the library and missing maps', async () => {
    await expect(textureFile('../../etc/passwd', 'diff', '1k')).rejects.toMatchObject({ status: 404 });
    await expect(textureFile('wood_floor', 'rough', '1k')).rejects.toMatchObject({ status: 404 });
  });

  it('maps only real library materials to plain Poly Haven ids', () => {
    const ids = new Set(MATERIALS.map((m) => m.id));
    for (const id of Object.keys(PHOTO_MATERIALS)) expect(ids.has(id), id).toBe(true);
    for (const a of PHOTO_ASSETS) expect(a).toMatch(/^[a-z0-9_]+$/);
  });
});

describe('photo tint', () => {
  const lin = (hex: string) => {
    const v = parseInt(hex.slice(1), 16);
    const c = (x: number) => ((x / 255) <= 0.04045 ? x / 255 / 12.92 : Math.pow((x / 255 + 0.055) / 1.055, 2.4));
    return { r: c((v >> 16) & 255), g: c((v >> 8) & 255), b: c(v & 255) };
  };
  const lum = (c: { r: number; g: number; b: number }) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

  it('keeps natural scans in their own colour (no neon grass)', () => {
    const grassScan = { r: 0.05, g: 0.07, b: 0.025 };
    const t = photoTint(lin('#5d7d3c'), grassScan, false);
    expect(t.r).toBe(t.g);
    expect(t.g).toBe(t.b);
    expect(t.r).toBeLessThanOrEqual(1.25);
  });

  it('recolours paint and plaster without blowing out the bright texels', () => {
    const plasterScan = { r: 0.42, g: 0.41, b: 0.38 };
    const t = photoTint(lin('#f1efea'), plasterScan, true);
    expect(Math.max(t.r, t.g, t.b)).toBeLessThanOrEqual(1.6 + 1e-9);
    expect(lum({ r: plasterScan.r * t.r, g: plasterScan.g * t.g, b: plasterScan.b * t.b })).toBeLessThanOrEqual(0.7 + 1e-9);
    // Still reads as white: neutral within a few percent.
    expect(Math.abs(t.r * plasterScan.r - t.b * plasterScan.b)).toBeLessThan(0.05);
  });

  it('never makes a dark scan exceed realistic reflectance', () => {
    const t = photoTint({ r: 1, g: 1, b: 1 }, { r: 0.02, g: 0.02, b: 0.02 }, false);
    expect(t.r * 0.02).toBeLessThan(0.05);
  });
});
