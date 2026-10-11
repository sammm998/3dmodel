import { getRepository } from '@/server/storage';
import { handle, HttpError, json } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ token: string }> };

/** Read-only project data for share links (no chat history). */
export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw new HttpError(404, 'Not found');
  const p = await getRepository().getProjectByShareToken(token);
  if (!p) throw new HttpError(404, 'Not found');
  return json({ project: { id: p.id, name: p.name, description: p.description, updatedAt: p.updatedAt, scene: p.scene } });
});
