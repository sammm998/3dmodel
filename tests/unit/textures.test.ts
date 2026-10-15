import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTextureFetch, textureFile, textureInfo } from '@/server/textures';
import { PHOTO_ASSETS, PHOTO_MATERIALS } from '@/core/materials/photo';
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
