import { getRepository } from '@/server/storage';
import { handle, HttpError, json } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string; vid: string }> };

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { id, vid } = await params;
  const version = await getRepository().getVersion(id, vid);
  if (!version) throw new HttpError(404, 'Version not found');
  return json({ version });
});
