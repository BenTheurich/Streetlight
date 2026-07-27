# Phase 3 Coverage History and Heatmap Implementation Plan

> **For coding agents:** Follow `AGENTS.md`, `PRODUCT.md`, and
> `docs/superpowers/specs/2026-07-27-phase3-coverage-design.md`. Execute tasks in order with
> test-first implementation and independent task review. Stop with Phase 3 `Awaiting human review`.

**Goal:** Deliver the main coverage dashboard with immutable segment history, corrections, age
colors, required totals, and isolated representative review data.

**Architecture:** Keep SQLite as the source of truth. Append correction rows to the existing event
table, load the modest church event set, and use one pure TypeScript derivation module for effective
dates, colors, histories, and period totals. Reuse the Phase 2 Google map and layout patterns. Add
no dependencies.

**Tech stack:** Next.js 16 App Router, React 19, TypeScript, Node `node:sqlite`, Google Maps
JavaScript API, native HTML controls, Node test runner.

**Prerequisite:** The founder's July 27 message explicitly approved Phase 2 and directed Phase 3
to begin. The import-completeness amendment and full local checks pass. The sandbox-blocked external
version-2 refresh is recorded as deferred; coverage work may proceed because it consumes the
unchanged stable segment contract and does not invoke the provider.

---

## Task 1: Coverage ledger, derivation, and database boundary

**Files:**
- Create: `web/db/migrations/006_coverage_history.sql`
- Create: `web/lib/coverage.ts`
- Create: `web/lib/coverage.test.ts`
- Modify: `web/lib/database.ts`
- Modify: `web/db/database.test.mjs`
- Modify: `web/package.json`

**Interfaces:**

```ts
type CoverageClass = 'red' | 'orange' | 'yellow' | 'green';

type CoverageWorkspace = {
  id: string;
  churchName: string;
  name: string;
  center: Position;
  asOf: string;
  activePackets: number;
  segments: CoverageSegment[];
  totals: { eligibleHomes: number };
};

getCoverageWorkspace(filename?: string, asOf?: string): CoverageWorkspace;
recordCoverageCompletion(segmentId: string, coveredOn: string, filename?: string): string;
appendCoverageCorrection(eventId: string, coveredOn: string | null, filename?: string): void;
```

- [ ] **Step 1: Write focused failing pure-domain tests**

Use literal event fixtures to prove all threshold boundaries (89/90, 179/180, 364/365), never
covered red, latest correction wins, void removes a root, a later correction restores it, multiple
completed roots select the latest effective date, date-only/future validation, and eligible-period
tract totals. Observe RED because `coverage.ts` does not exist.

- [ ] **Step 2: Implement the smallest pure derivation**

Validate real calendar dates at UTC midnight. Sort corrections by database sequence. Return
per-segment root histories, effective last-covered date, and one fixed coverage class. Count each
eligible segment once for period totals. Do not add reporting abstractions.

- [ ] **Step 3: Write failing migration/database tests**

Prove:

- update and delete attempts on `coverage_events` fail;
- invalid completed/correction shapes and correction-of-correction fail;
- an event whose church differs from its segment's church fails;
- completed rows with a correction target or nonzero void flag fail;
- correction rows with a missing root, invalid void flag, different church/physical segment, or
  non-completed target fail;
- an insert, date correction, void, and restoration preserve every row;
- unknown and future correction requests do not mutate;
- a retired segment's history appears on its current logical `import_segment_id`;
- workspace totals and active packet count match literal fixture values.

- [ ] **Step 4: Add migration and database functions**

Add `is_void INTEGER NOT NULL DEFAULT 0`, append-only triggers, correction-shape/target triggers, and
useful church/segment indexes. `appendCoverageCorrection` targets only a same-church completed root,
runs in `BEGIN IMMEDIATE`, and stores the effective date being voided when `coveredOn` is null.
Load event `rowid` as its deterministic sequence. Reuse current territory eligibility.

- [ ] **Step 5: Run focused checks**

```powershell
corepack pnpm --dir web test
corepack pnpm --dir web lint
corepack pnpm --dir web typecheck
git diff --check
```

- [ ] **Step 6: Commit**

```powershell
git add web/db/migrations/006_coverage_history.sql web/lib/coverage.ts web/lib/coverage.test.ts web/lib/database.ts web/db/database.test.mjs web/package.json
git commit -m "feat: add append-only coverage history"
```

## Task 2: Coverage dashboard, map, and correction endpoint

**Files:**
- Create: `web/lib/google-maps-browser.ts`
- Create: `web/components/CoverageMap.tsx`
- Create: `web/components/CoverageDashboard.tsx`
- Create: `web/app/api/coverage/route.ts`
- Create: `web/app/api/coverage/route.test.ts`
- Modify: `web/components/TerritoryMap.tsx`
- Modify: `web/app/page.tsx`
- Modify: `web/app/globals.css`
- Modify: `web/lib/database.ts`
- Modify: `web/package.json`

**Interfaces:**

```text
POST /api/coverage
{ "eventId": string, "coveredOn": "YYYY-MM-DD" | null }
```

- [ ] **Step 1: Extract only the shared browser-map loader**

Move the existing Google script promise and position conversion to one browser-only helper used by
both maps. Preserve Territory Setup behavior and add no provider abstraction.

- [ ] **Step 2: Implement the selectable heatmap**

Render every current segment with the pure derived class; excluded segments are gray. Reuse
zoom-sensitive stroke width and translucent strokes. Click selects; selected gets a stronger
stroke. Fit the initial territory bounds and render a compact five-state legend. Keep Google street
labels readable.

- [ ] **Step 3: Implement the sidebar**

Replace the root placeholder with the accepted map/sidebar shell. Show total eligible tracts,
estimated homes covered for native 30/90/180/365-day selection (90 default), and active packets.
The 90-day window is UTC `[asOf - 89 days, asOf]`. Provide a native eligible-segment select. For the
selected segment, render each completed root separately with its stable event ID, effective state,
correction history, own date input, and own undo action. Correcting an older root must leave newer
roots unchanged. Keep notices in an `aria-live` region and retain the accessible `Territory setup`
header link.

- [ ] **Step 4: Implement the correction endpoint**

Validate exact body keys through the coverage-domain parser. Append one correction and return the
refreshed workspace. Return safe 400/404 errors without SQLite details. The client disables only
the mutation in flight and keeps the selected segment on refresh. Add real route tests against a
temporary migrated database proving `segmentId`, `kind: "completed"`, extra keys, malformed/future
dates, and unknown roots are rejected without changing the event count. Let the database helper
honor `STREETLIGHT_DATABASE_PATH` at call time so the real route test uses its temporary database;
keep explicit filename arguments higher priority.

- [ ] **Step 5: Check both pages**

```powershell
corepack pnpm --dir web test
corepack pnpm --dir web lint
corepack pnpm --dir web typecheck
corepack pnpm --dir web build
git diff --check
```

Confirm direct HTTP returns 200 for `/` and `/territory`, and invalid correction JSON returns 400.

- [ ] **Step 6: Commit**

```powershell
git add web/lib/google-maps-browser.ts web/components/CoverageMap.tsx web/components/CoverageDashboard.tsx web/app/api/coverage/route.ts web/app/api/coverage/route.test.ts web/components/TerritoryMap.tsx web/app/page.tsx web/app/globals.css web/lib/database.ts web/package.json
git commit -m "feat: add coverage heatmap dashboard"
```

## Task 3: Isolated demo, full verification, and phase evidence

**Files:**
- Create: `web/db/seed-coverage-demo.mjs`
- Modify: `web/db/database.test.mjs`
- Modify: `web/package.json`
- Modify: `README.md`
- Modify: `IMPLEMENTATION_PLAN.md`

- [ ] **Step 1: Write a failing isolated-demo test**

Against a temporary path, run the explicit demo command twice. It must recreate only that exact
generated database. Assert representative green, yellow, orange, red, never, corrected, and voided
histories, one active packet, and stable row counts/classes after both runs. Assert normal
`seedDatabase` still creates zero coverage events and packets.

- [ ] **Step 2: Add the explicit demo seed**

Delete and recreate only `web/data/coverage-demo.db`, migrate and apply the normal seed, then add
relative-date coverage examples and one internally valid active packet with deterministic IDs.
Never touch `web/data/streetlight.db`. Reuse Task 2's `STREETLIGHT_DATABASE_PATH` support. Add one
exact `coverage:demo` command that recreates the demo and spawns Next directly on port 3001 with
that environment; do not call `pnpm dev`. Implement
`web/db/seed-coverage-demo.mjs --serve` so the same script seeds first, then uses Node
`child_process.spawn` with `process.execPath`, the installed Next CLI, arguments
`dev -p 3001`, `stdio: 'inherit'`, and a child `env` containing the absolute demo path as
`STREETLIGHT_DATABASE_PATH`. Set the cross-platform package script exactly to:

```json
"coverage:demo": "node db/seed-coverage-demo.mjs --serve"
```

Plain `node db/seed-coverage-demo.mjs <temporary-path>` remains non-serving for the twice-run seed
test.

- [ ] **Step 3: Run full verification**

```powershell
corepack pnpm check
git diff --check
```

Create the demo database, start an isolated server, and verify:

- `/` and `/territory` return 200;
- all four effective classes and a never-covered segment exist in the server workspace;
- changing the metric period changes the literal expected total;
- correction, void, restoration, and reload persist;
- malformed, future, and unknown-event requests fail without row-count changes;
- the normal founder database has no demo event IDs.

The required real-browser check remains unrun if the permitted Codex browser controller cannot
access localhost. Record that honestly, leave the isolated server plus exact founder review steps,
and keep Phase 3 `Awaiting human review`; do not substitute another automation tool or claim server
checks are browser evidence.

- [ ] **Step 4: Document operation and evidence**

Document the coverage-demo commands and all implementation defaults in `README.md`. Update
`IMPLEMENTATION_PLAN.md` with Phase 2 `Complete`, Phase 3 `Awaiting human review`, commit hashes,
test counts, threshold defaults, direct HTTP evidence, and the exact remaining human review.

- [ ] **Step 5: Commit**

```powershell
git add web/db/seed-coverage-demo.mjs web/db/database.test.mjs web/package.json README.md IMPLEMENTATION_PLAN.md
git commit -m "test: add isolated coverage review data"
```

## Final review checkpoint

Request independent full-diff review against `PRODUCT.md`, this design, and the implementation plan.
Resolve important findings with focused regressions. Re-run `corepack pnpm check` and
`git diff --check`. Stop before Phase 4 with Phase 3 `Awaiting human review`.
