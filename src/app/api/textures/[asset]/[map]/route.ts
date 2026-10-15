import { NextResponse } from 'next/server';
import { isPhotoAsset, textureFile, textureInfo } from '@/server/textures';
import { PHOTO_MAPS, PHOTO_RESOLUTIONS, type PhotoMap, type PhotoResolution } from '@/core/materials/photo';

export const runtime = 'nodejs';

/**
 * GET /api/textures/:asset/:map — photographed PBR maps (diff | nor | rough, JPEG)
 * or `meta` (tile size in metres) for the library's photo materials.
 */
export async function GET(req: Request, { params }: { params: Promise<{ asset: string; map: string }> }) {
  const { asset, map } = await params;
  if (!isPhotoAsset(asset)) return NextResponse.json({ error: 'unknown texture' }, { status: 404 });
  if (map === 'meta') {
    const info = await textureInfo(asset);
    return NextResponse.json(info, { headers: { 'cache-control': 'public, max-age=86400' } });
  }
  if (!PHOTO_MAPS.includes(map as PhotoMap)) return NextResponse.json({ error: 'unknown map' }, { status: 404 });
  const resParam = new URL(req.url).searchParams.get('res') ?? '1k';
  const res = (PHOTO_RESOLUTIONS as readonly string[]).includes(resParam) ? (resParam as PhotoResolution) : '1k';
  try {
    const buf = await textureFile(asset, map as PhotoMap, res);
    return new NextResponse(new Uint8Array(buf), { headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable' } });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 502;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
