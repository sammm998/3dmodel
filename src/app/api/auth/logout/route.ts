import { handle, json } from '@/server/http';
import { endSession } from '@/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handle(async (req: Request) => {
  const res = json({ ok: true });
  await endSession(req, res);
  return res;
});
