import { cookies } from 'next/headers';
import { SESSION_COOKIE, userFromToken } from './auth';

/** Signed-in user for server components (null when signed out or storage is unavailable). */
export async function getSessionUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    return await userFromToken(token);
  } catch {
    return null;
  }
}
