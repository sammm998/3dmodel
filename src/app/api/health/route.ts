import { getRepository } from '@/server/storage';
import { aiStatus } from '@/server/ai/providers';
import { json } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Liveness + diagnostics. Always 200 so the platform health check passes; storage errors are reported. */
export async function GET() {
  const repo = getRepository();
  let storageOk = true;
  let storageError: string | null = null;
  try {
    await repo.listProjects();
  } catch (e) {
    storageOk = false;
    storageError = e instanceof Error ? e.message : String(e);
    console.error('[health] storage check failed:', storageError);
  }
  return json({ ok: true, storage: repo.kind, storageOk, storageError, ai: aiStatus() });
}
