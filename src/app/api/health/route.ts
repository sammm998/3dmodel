import { getRepository } from '@/server/storage';
import { aiStatus } from '@/server/ai/providers';
import { handle, json } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handle(async () => {
  const repo = getRepository();
  await repo.listProjects();
  return json({ ok: true, storage: repo.kind, ai: aiStatus() });
});
