import { z } from 'zod';
import { assertSameOrigin, handle, json, readJson } from '@/server/http';
import { requireUser } from '@/server/auth';
import { createCheckout } from '@/server/billing';
import { siteOrigin } from '@/server/site';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ plan: z.enum(['pro', 'studio']), interval: z.enum(['monthly', 'yearly']).default('monthly') });

export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireUser(req);
  const { plan, interval } = Body.parse(await readJson(req));
  return json({ url: await createCheckout(user, plan, interval, siteOrigin(req)) });
});
