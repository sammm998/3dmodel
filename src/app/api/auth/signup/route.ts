import { z } from 'zod';
import { assertSameOrigin, handle, HttpError, json, readJson } from '@/server/http';
import { clientIp, hashPassword, normalizeEmail, publicUser, rateLimit, startSession } from '@/server/auth';
import { getRepository } from '@/server/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  name: z.string().trim().min(1, 'Enter your name').max(80),
  email: z.string().trim().email('Enter a valid email address').max(200),
  password: z.string().min(8, 'Use at least 8 characters').max(200),
});

export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  rateLimit(`signup:${clientIp(req)}`, 10, 60 * 60_000);
  const body = Body.parse(await readJson(req));
  const repo = getRepository();
  const email = normalizeEmail(body.email);
  if (await repo.getUserByEmail(email)) throw new HttpError(409, 'An account with this email already exists. Sign in instead.');
  const first = (await repo.countUsers()) === 0;
  let user;
  try {
    user = await repo.createUser({ email, name: body.name, passwordHash: await hashPassword(body.password) });
  } catch (e) {
    if (/unique|duplicate/i.test(String((e as Error).message))) throw new HttpError(409, 'An account with this email already exists. Sign in instead.');
    throw e;
  }
  // Projects created before accounts existed belong to the first account (the owner of the installation).
  if (first) await repo.claimOrphanProjects(user.id);
  const res = json({ user: publicUser(user) }, 201);
  await startSession(req, res, user.id);
  return res;
});
