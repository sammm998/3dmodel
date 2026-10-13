/**
 * Accounts and sessions: scrypt password hashes, opaque session tokens in an
 * HttpOnly cookie (only a SHA-256 of the token is stored), plan resolution and
 * per-month AI quotas.
 */
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { NextResponse } from 'next/server';
import { getPlan, usagePeriod, type ExportFormat, type PlanId } from '@/core/billing/plans';
import { getRepository } from './storage';
import type { ProjectRecord, UserRecord } from './storage/types';
import { HttpError } from './http';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;

export const SESSION_COOKIE = 'a3d_session';
const SESSION_DAYS = 30;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password.normalize('NFKC'), salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, { N: +N, r: +r, p: +p, maxmem: SCRYPT.maxmem });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isHttps(req: Request): boolean {
  const proto = req.headers.get('x-forwarded-proto');
  if (proto) return proto.split(',')[0].trim() === 'https';
  return new URL(req.url).protocol === 'https:';
}

/** Starts a session for the user and sets the cookie on the response. */
export async function startSession(req: Request, res: NextResponse, userId: string) {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await getRepository().createSession(sha256(token), userId, expires);
  res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: isHttps(req), path: '/', expires });
}

export async function endSession(req: Request, res: NextResponse) {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) await getRepository().deleteSession(sha256(token));
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', secure: isHttps(req), path: '/', maxAge: 0 });
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** Resolves the user of a session token (cookie value). */
export async function userFromToken(token: string | null | undefined): Promise<UserRecord | null> {
  if (!token || token.length > 200) return null;
  const repo = getRepository();
  const session = await repo.getSession(sha256(token));
  if (!session) return null;
  return repo.getUserById(session.userId);
}

export function currentUser(req: Request): Promise<UserRecord | null> {
  return userFromToken(readCookie(req, SESSION_COOKIE));
}

export async function requireUser(req: Request): Promise<UserRecord> {
  const user = await currentUser(req);
  if (!user) throw new HttpError(401, 'Please sign in to continue.');
  return user;
}

/** Loads a project the current user owns (404 otherwise, so ids do not leak). */
export async function requireProject(req: Request, id: string): Promise<{ user: UserRecord; project: ProjectRecord }> {
  const user = await requireUser(req);
  const project = await getRepository().getProject(id);
  if (!project || project.ownerId !== user.id) throw new HttpError(404, 'Project not found');
  return { user, project };
}

export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => normalizeEmail(s))
    .filter(Boolean);
}

/** The plan whose limits apply (admins always get Studio). */
export function effectivePlan(user: UserRecord): PlanId {
  if (adminEmails().includes(user.email)) return 'studio';
  return user.plan;
}

export async function usageOf(user: UserRecord) {
  const plan = getPlan(effectivePlan(user));
  const usage = await getRepository().getUsage(user.id, usagePeriod());
  const projects = await getRepository().countProjects(user.id);
  return { period: usagePeriod(), aiRequests: usage.ai ?? 0, aiLimit: plan.limits.aiRequests, projects, projectLimit: plan.limits.projects };
}

/** Throws 402 when the monthly AI quota is used up; otherwise counts one request. */
export async function consumeAiRequest(user: UserRecord) {
  const plan = getPlan(effectivePlan(user));
  const repo = getRepository();
  const used = (await repo.getUsage(user.id, usagePeriod())).ai ?? 0;
  if (used >= plan.limits.aiRequests) {
    throw new HttpError(402, `You have used all ${plan.limits.aiRequests} AI requests included in ${plan.name} this month. Upgrade your plan for more, or keep editing with the built-in interpreter.`, {
      code: 'quota_exceeded',
    });
  }
  await repo.incrementUsage(user.id, usagePeriod(), 'ai', 1);
}

export async function assertCanCreateProject(user: UserRecord) {
  const plan = getPlan(effectivePlan(user));
  if (plan.limits.projects === null) return;
  const n = await getRepository().countProjects(user.id);
  if (n >= plan.limits.projects) {
    throw new HttpError(402, `${plan.name} includes ${plan.limits.projects} projects. Delete a project or upgrade to create more.`, { code: 'project_limit' });
  }
}

export function assertExportAllowed(user: UserRecord, format: string) {
  const plan = getPlan(effectivePlan(user));
  const f = (format === 'mtl' ? 'obj' : format) as ExportFormat;
  if (!plan.limits.exportFormats.includes(f)) {
    throw new HttpError(402, `${format.toUpperCase()} export is included in Pro and Studio.`, { code: 'export_not_in_plan' });
  }
}

export function publicUser(user: UserRecord) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    plan: effectivePlan(user),
    subscribedPlan: user.plan,
    planStatus: user.planStatus,
    currentPeriodEnd: user.currentPeriodEnd,
    hasBilling: !!user.stripeCustomerId,
    createdAt: user.createdAt,
  };
}
export type PublicUser = ReturnType<typeof publicUser>;

/** Simple in-memory sliding-window limiter for auth endpoints (per process). */
const buckets = new Map<string, number[]>();
export function rateLimit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) throw new HttpError(429, 'Too many attempts. Please wait a minute and try again.');
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 10_000) buckets.clear();
}

export function clientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0].trim() || req.headers.get('x-real-ip') || 'local';
}
