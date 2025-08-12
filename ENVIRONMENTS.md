# Environments and Variables

| App | Variable | Where to Set | Purpose |
|-----|----------|--------------|---------|
| web | `NEXT_PUBLIC_API_BASE_URL` | Vercel Project → Settings → Environment Variables | Base URL for API calls from the browser |
| web | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Vercel Project → Settings → Environment Variables | Clerk publishable key for frontend |
| web | `CLERK_SECRET_KEY` | Vercel Project → Settings → Environment Variables | Clerk secret key for server actions/middleware |
| web | `NEXT_PUBLIC_GOOGLE_MAPS_JS_KEY` | Vercel Project → Settings → Environment Variables | Google Maps JS API key (optional) |
| web | `NEXT_PUBLIC_SENTRY_DSN` | Vercel Project → Settings → Environment Variables | Sentry DSN (optional) |
| api | `PORT` | Fly Secrets/Env | Port for the API (default 4000) |
| api | `NODE_ENV` | Fly Secrets/Env | Node environment |
| api | `WEB_ORIGIN` | Fly Secrets/Env | Allowed web origin for CORS |
| api | `CLERK_JWKS_URL` | Fly Secrets/Env | JWKS URL for Clerk (e.g., `https://<clerk-domain>/.well-known/jwks.json`) |
| api | `CLERK_ISSUER` | Fly Secrets/Env | Expected JWT issuer (e.g., `https://<clerk-domain>/`) |
| api | `CLERK_AUDIENCE` | Fly Secrets/Env | Expected JWT audience (e.g., `streetlight-api`) |
| api | `DISABLE_AUTH` | Fly Secrets/Env | Set `true` to bypass auth guard in development |
| api | `DATABASE_URL` | Fly Secrets/Env | Placeholder for future DB connectivity |

## Local Development
- Create `web/.env.local` from `web/.env.example`.
- Create `api/.env` from `api/.env.example`.
