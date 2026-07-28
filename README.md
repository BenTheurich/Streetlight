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
- Python 3.12 or newer for the Overture importer

## Canonical commands

Run these from the repository root:

| Task | Command |
|---|---|
| Install | `pnpm install --frozen-lockfile` |
| Install importer | `python -m pip install -r web/importer/requirements.txt` |
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

The Overture import needs network access but no API key. It uses `python` by default.
Set `STREETLIGHT_PYTHON` only when `python` is not the desired executable.

## Phase 2 local review

Territory Setup is at `http://localhost:3000/territory`. Add the following to the
ignored root `.env.local` before running `pnpm dev`:

```dotenv
GOOGLE_MAPS_BROWSER_API_KEY=your_browser_restricted_key
GOOGLE_MAPS_SERVER_API_KEY=your_server_restricted_key
```

The browser key renders the interactive administrator map. The server key resolves a
changed church address without exposing that credential to the browser. See
[ENVIRONMENTS.md](ENVIRONMENTS.md) for the required API and application restrictions.

For Phase 2 review, adjust the radius, draw and reshape an exclusion, confirm affected
segments turn gray, save, reload, and then confirm that `Cancel` restores the last saved
territory. Click one orange segment, exclude it, save and reload, then click the same gray segment
and restore it. The phase remains awaiting founder approval; Phase 3 must not begin yet.
