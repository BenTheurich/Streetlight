# API (/api)

NestJS REST API shell with health check and Clerk JWT guard (config-driven).

## Run Locally
```bash
pnpm i
pnpm --filter api dev
```

## Environment
Copy `.env.example` → `.env` and set values. `DISABLE_AUTH=true` lets you bypass auth in development.

## Deploy to Fly.io
1. Install the Fly CLI and run `fly auth login`.
2. From `/api`, run `fly launch` (choose an app name or keep `streetlight-api`). This generates or updates `fly.toml`.
3. Set secrets (example):
   ```bash
   fly secrets set          PORT=4000          NODE_ENV=production          WEB_ORIGIN=https://your-vercel-domain.vercel.app          CLERK_JWKS_URL=https://<your-clerk-domain>/.well-known/jwks.json          CLERK_ISSUER=https://<your-clerk-domain>/          CLERK_AUDIENCE=streetlight-api          DISABLE_AUTH=false
   ```
4. Deploy:
   ```bash
   fly deploy
   ```
5. Once deployed, `GET /healthz` should return `{ "ok": true }`.
