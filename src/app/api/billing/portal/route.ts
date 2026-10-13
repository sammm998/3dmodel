import { assertSameOrigin, handle, json } from '@/server/http';
import { requireUser } from '@/server/auth';
import { createPortal } from '@/server/billing';
import { siteOrigin } from '@/server/site';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireUser(req);
  return json({ url: await createPortal(user, siteOrigin(req)) });
});
