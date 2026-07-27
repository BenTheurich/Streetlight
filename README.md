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
| Start the isolated coverage review | `pnpm --dir web coverage:demo` |

`pnpm dev` applies migrations and loads the idempotent local seed automatically,
then serves Streetlight at `http://localhost:3000`.

The local database is `web/data/streetlight.db`. It is generated, ignored by Git,
and can be rebuilt with the migration and seed commands.

The Overture import needs network access but no API key. It uses `python` by default.
Set `STREETLIGHT_PYTHON` only when `python` is not the desired executable.

## Coverage dashboard and Phase 3 review

Coverage is the root route at `http://localhost:3000/`; Territory Setup remains at
`http://localhost:3000/territory`. Add the following to the
ignored root `.env.local` before running `pnpm dev`:

```dotenv
GOOGLE_MAPS_BROWSER_API_KEY=your_browser_restricted_key
GOOGLE_MAPS_SERVER_API_KEY=your_server_restricted_key
```

The browser key renders the interactive administrator map. The server key resolves a
changed church address without exposing that credential to the browser. See
[ENVIRONMENTS.md](ENVIRONMENTS.md) for the required API and application restrictions.

Coverage is derived from append-only outreach events. Changing a date and undoing a completion add
correction rows; they never replace or remove the original completion. The map uses green for
0-89 days, yellow for 90-179, orange for 180-364, and red for 365+ days or never covered.
The 30/90/180/365-day home metric includes both UTC endpoints: a 90-day selection is
`[asOf - 89 days, asOf]`.

For founder review, run `pnpm --dir web coverage:demo` and open `http://localhost:3001`.
It recreates only `web/data/coverage-demo.db`, then starts Next with that isolated database. The
demo has green, yellow, orange, red, never-covered, corrected, and undone examples plus one active
packet. Inspect every map color, change the period, select segments, change a date, undo one,
reload, and confirm the history and totals persist.

`pnpm db:seed` and `pnpm dev` never add fake outreach, batches, packets, or demo IDs to the
founder's `web/data/streetlight.db`; representative data exists only in the explicit demo file.
