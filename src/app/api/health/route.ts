import { getRepository } from '@/server/storage';
import { aiStatus } from '@/server/ai/providers';
import { json } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Liveness + diagnostics. Always 200 so the platform health check passes; storage problems are reported. */
export async function GET() {
  const repo = getRepository();
  const status = await repo.status();
  let storageOk = true;
  let storageError: string | null = null;
  try {
    await repo.countUsers();
  } catch (e) {
    storageOk = false;
    storageError = e instanceof Error && e.message ? e.message : String(e);
    console.error('[health] storage check failed:', storageError);
  }
  return json({
    ok: true,
    build: process.env.NEXT_PUBLIC_BUILD_ID ?? 'dev',
    storage: status.kind,
    storageOk,
    storageError,
    databaseConfigured: status.databaseConfigured,
    databaseFallbackReason: status.fallbackReason,
    storagePersistent: status.persistent,
    ai: aiStatus(),
  });
}
