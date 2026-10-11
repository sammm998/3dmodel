import { getRepository } from '@/server/storage';
import { getObjectStorage } from '@/server/storage/objectStorage';
import { handle, HttpError, json, readJson } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ aid: string }> };

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { aid } = await params;
  const asset = await getRepository().getAsset(aid);
  if (!asset) throw new HttpError(404, 'Asset not found');
  const data = await getObjectStorage().get(asset.storageKey);
  if (!data) throw new HttpError(404, 'Asset data missing');
  return new Response(new Uint8Array(data), {
    headers: { 'content-type': asset.mime, 'content-disposition': `inline; filename="${asset.filename.replace(/"/g, '')}"`, 'cache-control': 'private, max-age=3600' },
  });
});

/** Stores user-confirmed drawing analysis (calibration, corrected walls). */
export const PATCH = handle(async (req: Request, { params }: Ctx) => {
  const { aid } = await params;
  const body = (await readJson(req)) as { analysis?: unknown };
  const repo = getRepository();
  if (!(await repo.getAsset(aid))) throw new HttpError(404, 'Asset not found');
  const size = JSON.stringify(body.analysis ?? null).length;
  if (size > 2_000_000) throw new HttpError(413, 'Analysis too large');
  await repo.updateAssetAnalysis(aid, body.analysis ?? null);
  return json({ ok: true });
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  const { aid } = await params;
  const repo = getRepository();
  const asset = await repo.getAsset(aid);
  if (!asset) throw new HttpError(404, 'Asset not found');
  await getObjectStorage().delete(asset.storageKey);
  await repo.deleteAsset(aid);
  return json({ ok: true });
});
