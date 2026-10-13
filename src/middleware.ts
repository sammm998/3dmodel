import { NextResponse, type NextRequest } from 'next/server';

/** Signed-out visitors of app pages go to the sign-in page (sessions are verified server-side). */
export function middleware(req: NextRequest) {
  if (req.cookies.get('a3d_session')?.value) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = { matcher: ['/app/:path*', '/project/:path*', '/account/:path*'] };
