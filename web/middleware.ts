import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

// Any paths you want to require sign-in for:
const isProtectedRoute = createRouteMatcher([
  '/admin(.*)',        // protect /admin and all subpaths
  // add more here later, e.g. '/dashboard(.*)'
]);

export default clerkMiddleware((auth, req) => {
  if (isProtectedRoute(req)) {
    auth().protect();  // ⬅️ this enforces sign-in
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals & static files
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes (lets you use auth() in /api/*)
    '/(api|trpc)(.*)',
  ],
};
