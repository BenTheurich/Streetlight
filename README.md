# Streetlight Monorepo

Production-ready monorepo with Next.js (web) and NestJS (api).

## Quickstart
```bash
pnpm i
pnpm dev
```
- Web: http://localhost:3000
- API: http://localhost:4000

## Scripts
- `pnpm dev`: runs both apps
- `pnpm build`: build all workspaces
- `pnpm lint`: lint all workspaces
- `pnpm test`: test all workspaces
- `pnpm typecheck`: type-check all workspaces

## CI Overview
GitHub Actions runs two independent jobs (web, api) with path filters. Each job installs, lints, type-checks, tests, and builds.

## Deploy
- Web to Vercel: see `web/README.md`
- API to Fly.io: see `api/README.md`
