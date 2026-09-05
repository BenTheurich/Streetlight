# Streetlight

Streetlight is a web application for churches that organize house-to-house tract distribution.

Read [PRODUCT.md](PRODUCT.md) for the approved product definition and founder decisions.
Read [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for the phased build and current status.

## Application foundation

The application is one Next.js App Router project in `web`, backed by SQLite through
Node's built-in `node:sqlite` module. SQL migrations live in `web/db/migrations`.
WorkOS AuthKit provides invite-only administrator authentication. Deployment and recovery remain
in Phase 12 of the implementation plan.

Requirements:

- Node.js 24.15 or newer
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
| Start the isolated progress review | `pnpm --dir web progress:demo` |

`pnpm dev` applies migrations and loads the idempotent local seed automatically,
then serves Streetlight at `http://localhost:3000`.

The local database is `web/data/streetlight.db`, created on first use and ignored by Git.
Migrations and the idempotent seed prepare it; they do not restore saved outreach history.
Preserve the database once it contains church work. Phase 12 owns backup and restore verification.

The Overture import needs network access but no API key. It uses `python` by default.
Set `STREETLIGHT_PYTHON` only when `python` is not the desired executable.

## Administrator workspace

Signed-out visitors see the public site at `http://localhost:3000/`. After sign-in, configured
churches use one persistent workspace at the same address. Coverage, Packets, Outreach Progress,
and Setup are tools inside it. Region configuration and printout settings live in Setup.

Store local Google Maps and WorkOS configuration in the ignored `web/.env.local` file. Next.js
loads it for the application, and the seed command uses the same location. For maps:

```dotenv
GOOGLE_MAPS_BROWSER_API_KEY=your_browser_restricted_key
GOOGLE_MAPS_SERVER_API_KEY=your_server_restricted_key
```

The browser key powers the labeled hybrid Satellite view and church-address suggestions. The
server key resolves a changed church address without exposing that credential to the browser. See
[ENVIRONMENTS.md](ENVIRONMENTS.md) for the required API and application restrictions.

Coverage is derived from append-only outreach events. Changing a date and undoing a completion add
correction rows; they never replace or remove the original completion. Each territory saves the
days when its map changes to yellow, orange, and red. The defaults are 90, 180, and 365 days;
never-covered streets remain red. The Coverage sidebar shows eligible estimated homes by heatmap
color. Outreach Progress provides the separate calendar-year and past-year views.

For canonical founder review, run `pnpm --dir web dev` and open `http://localhost:3000`. Confirm the
saved territory streets load, edit and save the three heatmap ranges, reload, and open Setup to
inspect hidden-road activation and exact-segment exclusion controls.

For an optional review of every history state, run `pnpm --dir web coverage:demo` and open
`http://localhost:3001`. It recreates only `web/data/coverage-demo.db`, labels the page as demo
data, copies the current imported territory, and adds coherent 30-, 120-, 240-, and 500-day
geographic bands while leaving the far edge never covered.

`pnpm db:seed` and `pnpm dev` never add fake outreach, batches, packets, or demo IDs to the
founder's `web/data/streetlight.db`; representative data exists only in the explicit demo file.

## Packet preparation and reconciliation

In Packets, open Generate, enter quantity and tract-target rows, then generate proposals and
inspect their maps and starting addresses. Proposals do not reserve streets. Finalizing reserves
the selected proposals and downloads that exact batch as one PDF. A failed download can retry the
same saved batch, even after another administrator finalizes a newer batch.

The explicit newest-batch and all-active-packets downloads remain available. Reconcile records
whole-packet completion or cancellation from the paper sheets still present. Corrections retain
history, and undo rejects any street already reserved by another active packet, including after
a region reimport.

## Tests

`pnpm test` discovers `.test.ts` and `.test.mjs` files under `web/app`, `web/components`, `web/db`,
and `web/lib`, plus the configuration tests in `web`. The existing TSX registration supports
rendered React checks in the same run. New tests in those directories need no package-script edit.
The root command also runs the Python launcher and importer suites. Test fixtures use disposable
databases and fake provider calls; they do not create WorkOS organizations or send invitations.
