// web/middleware.ts
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isProtectedRoute = createRouteMatcher(['/admin(.*)']);

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    const session = await auth();           // <- await the promise
    if (!session.userId) {
      return session.redirectToSignIn();    // <- correct helper
    }
  }
});

export const config = {
  matcher: [
    // Run on app routes, skip static/_next
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes so auth() works in /api/*
    '/(api|trpc)(.*)',
  ],
};
