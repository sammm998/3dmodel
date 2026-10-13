import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

/** Wraps a route handler with consistent error responses. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, details: e.details }, e.status);
      if (e instanceof ZodError) return json({ error: 'Validation failed', details: e.issues.slice(0, 20) }, 400);
      console.error(e);
      return json({ error: e instanceof Error ? e.message : 'Internal error' }, 500);
    }
  };
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, 'Request body must be JSON');
  }
}

/**
 * Rejects cross-site state-changing requests (defence in depth on top of
 * SameSite=Lax cookies): when the browser sends Origin, it must match Host.
 */
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  if (!origin) return;
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  try {
    if (host && new URL(origin).host !== host.split(',')[0].trim()) throw new HttpError(403, 'Cross-site request blocked');
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(403, 'Invalid origin');
  }
}
