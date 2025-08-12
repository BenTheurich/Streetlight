// web/middleware.ts
import { clerkMiddleware } from '@clerk/nextjs/server';

export default clerkMiddleware();

export const config = {
  matcher: [
    '/admin/:path*',                 // your protected pages
    '/(api|trpc)(.*)',               // <-- ensure API routes go through Clerk
  ],
};