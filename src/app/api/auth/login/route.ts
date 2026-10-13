import { z } from 'zod';
import { assertSameOrigin, handle, HttpError, json, readJson } from '@/server/http';
import { clientIp, normalizeEmail, publicUser, rateLimit, startSession, verifyPassword } from '@/server/auth';
import { getRepository } from '@/server/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ email: z.string().trim().max(200), password: z.string().max(200) });

export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const body = Body.parse(await readJson(req));
  const email = normalizeEmail(body.email);
  rateLimit(`login:${clientIp(req)}`, 20, 10 * 60_000);
  rateLimit(`login:${email}`, 8, 10 * 60_000);
  const user = await getRepository().getUserByEmail(email);
  const ok = user ? await verifyPassword(body.password, user.passwordHash) : false;
  if (!user || !ok) throw new HttpError(401, 'Incorrect email or password.');
  const res = json({ user: publicUser(user) });
  await startSession(req, res, user.id);
  return res;
});
