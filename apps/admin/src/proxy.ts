import { type NextRequest, NextResponse } from 'next/server';

/** Anonymous visitors are sent to the admin login; the API enforces roles. */
export function proxy(request: NextRequest) {
  const signedIn = request.cookies.get('svpn_session')?.value === '1';
  const isLogin = request.nextUrl.pathname === '/login';
  if (!signedIn && !isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|icon.svg).*)'],
};
