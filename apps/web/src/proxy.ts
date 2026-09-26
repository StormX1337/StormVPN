import { type NextRequest, NextResponse } from 'next/server';

const SESSION_HINT = 'svpn_session';
const PROTECTED = ['/dashboard', '/servers', '/connection', '/devices', '/subscription', '/account', '/billing'];
const GUEST_ONLY = ['/login', '/register'];

/**
 * UX-level route guard: redirects anonymous visitors to the login page and
 * signed-in users away from auth pages. Authorization itself is always
 * enforced by the API.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const signedIn = request.cookies.get(SESSION_HINT)?.value === '1';

  if (!signedIn && PROTECTED.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    const url = new URL('/login', request.url);
    url.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(url);
  }
  if (signedIn && GUEST_ONLY.includes(pathname)) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|ico|webp)$).*)'],
};
