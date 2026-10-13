import { randomBytes } from 'node:crypto';
import { getRepository } from '@/server/storage';
import { handle, json } from '@/server/http';
import { requireProject } from '@/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

/** Creates (or returns) a read-only share token. */
export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const repo = getRepository();
  const { project } = await requireProject(req, id);
  const token = project.shareToken ?? randomBytes(18).toString('base64url');
  if (!project.shareToken) await repo.setShareToken(id, token);
  return json({ token, path: `/share/${token}` });
});

export const DELETE = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  await requireProject(req, id);
  await getRepository().setShareToken(id, null);
  return json({ ok: true });
});
