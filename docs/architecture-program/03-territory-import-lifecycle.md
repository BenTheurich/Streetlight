# Task 03: Deepen the territory import lifecycle

## Objective

Give one module ownership of persisted territory-import creation, execution, progress, stale-job handling, completion, failure, and reconnection. Route adapters should request product operations without coordinating lifecycle transitions.

Record the authenticated geocoding quota requirement at its approved Phase 12 deployment seam.

## Program position

- Branch: `codex/arch-03-import-lifecycle`
- PR base: `codex/architecture-review`
- Depends on: Tasks 01 and 02 merged
- Required next task: Task 04

Follow `ORCHESTRATION.md` for the complete task cycle.

## Required context

Read:

- `PRODUCT.md:250-270` for region saves and persisted background jobs.
- `PRODUCT.md:564-594` for the single-container pilot architecture.
- The current region persistence module produced by Task 02.
- `web/lib/territory-import-job.ts` and its tests.
- `web/app/api/territory/route.ts` and `web/app/api/territory/import/route.ts` plus their tests.
- `web/lib/overture-import.ts`.
- `web/lib/workspace-scope.ts`.
- `web/app/api/geocode/route.ts` and `web/lib/google-maps-server.ts`.

## Observed pressure

The reviewed import-job module exposes ten lifecycle functions. The territory PATCH route calls create-or-reuse and ensure-running separately. The polling route gets the latest job, ensures it is running, and reads it again. Callers therefore learn transition ordering, stale-job behavior, and reread requirements.

The module also owns a process-local running-job map, persisted rows, transition SQL, heartbeat updates, workspace scoping, Python execution, and atomic region replacement. That implementation has useful depth, but its interface exposes too much lifecycle machinery.

The authenticated geocoding route validates address input but has no application quota. `PRODUCT.md` already assigns Google quota configuration to Phase 12.

## Scope

### Lifecycle interface

Select a small interface around current product operations. It must cover:

- Submit an import-required region save or reuse the matching active job.
- Observe the current persisted job and any completed workspace result.
- Reconnect after refresh or process restart.
- Report truthful coarse progress.
- Mark stale interrupted work without replacing the prior region.
- Retry after failure or interruption.

The module owns transition ordering and all private state changes. Routes translate authenticated HTTP input and output only.

### Persistence and execution

Use the workflow persistence seam from Task 02. Do not expose a raw database handle through the lifecycle interface. Keep the Python process adapter from Task 01.

The process-local running-job map may remain an internal implementation detail for the approved single-container pilot. Persisted state remains authoritative across refresh and restart.

### Tests through the interface

Replace direct tests of private transition helpers once the same behavior is covered through the selected lifecycle interface. Keep low-level tests only for invariants that cannot be observed through the product operation.

Test two real adapters at justified seams:

- Production Python process and deterministic fake process for importer execution.
- Production SQLite implementation and temporary SQLite database for persistence.

Do not add an external worker port. The pilot has one production execution path.

### Geocoding quota disposition

Keep strict address validation and authenticated access. Add application quota code only if the repository contains an approved identity, threshold, reset policy, and user response. Otherwise record the exact Google Cloud quota and budget configuration required in Phase 12, including how deployment verification will prove it. Do not choose a numeric quota inside this task.

## Required invariants

- One church has at most one matching active import job for a draft fingerprint.
- Matching requests are idempotent.
- Initial setup stays locked until its first region succeeds.
- An established church continues using its prior saved region while replacement work runs.
- Success swaps the new region in one atomic transaction.
- Failure or interruption leaves the prior region and history unchanged.
- Refresh reconnects to persisted state and truthful progress.
- A stale running job becomes retryable without pretending it succeeded.
- Workspace scope remains attached across asynchronous callbacks.
- The job runner remains inside the one Railway application container.
- Apartments remain disabled.

## Acceptance criteria

1. Territory routes no longer call or order private lifecycle transitions.
2. The lifecycle module exposes a smaller interface than the reviewed ten-function interface.
3. Old lifecycle exports disappear after callers and tests move.
4. Focused tests cover new job, matching reuse, active polling, refresh reconnection, stale interruption, retry, process failure, invalid process output, atomic success, and prior-region preservation.
5. Tests prove one church cannot observe or resume another church's job.
6. Heartbeat or progress-report failure cannot corrupt the final region result.
7. Process restart behavior follows `PRODUCT.md` and returns a retryable state.
8. Geocoding quota ownership is implemented from an approved policy or recorded as an exact Phase 12 control.
9. No queue, Redis instance, worker deployment, or second database appears.

## Focused verification

```text
pnpm --dir web exec node --test lib/territory-import-job.test.ts
pnpm --dir web exec node --test app/api/territory/route.test.ts app/api/territory/import/route.test.ts
pnpm --dir web exec node --test lib/overture-import.test.ts
pnpm --dir web exec node --test lib/authenticated-route.test.ts
```

Then run every program check from `ORCHESTRATION.md`.

Run a controlled process-failure test with an explicit missing Python executable. Run a successful deterministic fake import. Do not download live Overture data merely to test state transitions.

## Reviewer focus

The reviewer must answer:

- Can a route caller put the job into an invalid transition order?
- Is persisted state authoritative after refresh and restart?
- Does the lifecycle interface hide SQL, process, heartbeat, and stale-job details?
- Did tests move to the same interface used by routes?
- Can simultaneous matching requests launch duplicate imports?
- Does any failure replace or partially mutate the prior region?
- Did geocoding quota work avoid an unapproved threshold?

## Excluded work

- Import normalization changes.
- External workers, queues, Redis, or PostgreSQL.
- Percentage progress or resumable provider downloads.
- Region Setup React state, which belongs to Task 04.
- Map overlay changes, which belong to Task 05.

## Completion evidence

The PR must include:

- Before-and-after lifecycle interfaces.
- The old exported transitions removed.
- Transition, restart, failure, and isolation test results.
- Geocoding quota implementation evidence or exact Phase 12 disposition.
