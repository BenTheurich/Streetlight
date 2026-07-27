# Streetlight

Streetlight is a web application for churches that organize house-to-house tract distribution.

Read [PRODUCT.md](PRODUCT.md) for the approved product definition and founder decisions.
Read [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for the phased build and current status.

## Application foundation

The application is one Next.js App Router project in `web`, backed by SQLite through
Node's built-in `node:sqlite` module. SQL migrations live in `web/db/migrations`.
Authentication and deployment intentionally wait for their planned phases.

Requirements:

- Node.js 22.13 or newer
- pnpm 10.27

## Canonical commands

Run these from the repository root:

| Task | Command |
|---|---|
| Install | `pnpm install --frozen-lockfile` |
| Apply migrations | `pnpm db:migrate` |
| Load local seed data | `pnpm db:seed` |
| Start locally | `pnpm dev` |
| Lint | `pnpm lint` |
| Typecheck | `pnpm typecheck` |
| Test | `pnpm test` |
| Production build | `pnpm build` |
| Run every code check | `pnpm check` |

`pnpm dev` applies migrations and loads the idempotent local seed automatically,
then serves Streetlight at `http://localhost:3000`.

The local database is `web/data/streetlight.db`. It is generated, ignored by Git,
and can be rebuilt with the migration and seed commands.
