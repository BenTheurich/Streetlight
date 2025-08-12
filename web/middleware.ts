import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isAdminPath = pathname.startsWith('/admin');
  if (!isAdminPath) return NextResponse.next();

  const hasClerk =
    !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && !!process.env.CLERK_SECRET_KEY;

  // If Clerk keys are set, enforce a basic guard (demo cookie in this stub).
  if (hasClerk) {
    const signedIn = req.cookies.get('demoSignedIn')?.value === 'true';
    if (!signedIn) {
      const url = req.nextUrl.clone();
      url.pathname = '/sign-in';
      return NextResponse.redirect(url);
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*'],
};
