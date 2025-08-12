# Web (/web)

Next.js 14 App Router + TypeScript admin shell.

## Run Locally
```bash
pnpm i
pnpm --filter web dev
```

## Environment
Copy `.env.example` → `.env.local` and set variables.

## Deploy to Vercel
1. Create a new Vercel project and select the monorepo.
2. Set the project root to `web`.
3. Environment Variables:
   - `NEXT_PUBLIC_API_BASE_URL`
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
   - `CLERK_SECRET_KEY`
   - (optional) `NEXT_PUBLIC_GOOGLE_MAPS_JS_KEY`, `NEXT_PUBLIC_SENTRY_DSN`
4. Build Command: `pnpm --filter web build`
5. Install Command: `pnpm install --frozen-lockfile`
6. Output: `.next` (default)
