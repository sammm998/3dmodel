import { z } from 'zod';
import { assertSameOrigin, handle, HttpError, json, readJson } from '@/server/http';
import { currentUser, endSession, publicUser, requireUser, usageOf, verifyPassword } from '@/server/auth';
import { billingConfigured, cancelSubscriptionNow } from '@/server/billing';
import { getRepository } from '@/server/storage';
import { getObjectStorage } from '@/server/storage/objectStorage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handle(async (req: Request) => {
  const user = await currentUser(req);
  if (!user) return json({ user: null, billing: billingConfigured() });
  return json({ user: publicUser(user), usage: await usageOf(user), billing: billingConfigured() });
});

/** Permanently deletes the account and everything in it (password confirmation required). */
export const DELETE = handle(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireUser(req);
  const { password } = z.object({ password: z.string().max(200) }).parse(await readJson(req));
  if (!(await verifyPassword(password, user.passwordHash))) throw new HttpError(401, 'Incorrect password.');
  if (user.stripeSubscriptionId) await cancelSubscriptionNow(user.stripeSubscriptionId);
  const repo = getRepository();
  const storage = getObjectStorage();
  for (const p of await repo.listProjects(user.id)) for (const a of await repo.listAssets(p.id)) await storage.delete(a.storageKey).catch(() => {});
  await repo.deleteUser(user.id);
  const res = json({ ok: true });
  await endSession(req, res);
  return res;
});
