# Phase 6 Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconcile finalized street and apartment packets against the physical table, with atomic history-preserving correction and undo.

**Architecture:** Extend the existing SQLite coverage history with packet-linked street or apartment targets, keep validation and transactions in the current database boundary, and expose one reconciliation API. Add one shared-workspace tool whose sidebar state drives a lightweight map overlay.

**Tech Stack:** Next.js 16, React 19, TypeScript, `node:sqlite`, Google Maps JavaScript API, Node test runner, Biome.

## Global Constraints

- Reconciliation is whole-packet and atomic; there is no partial packet state.
- The server supplies the current church-local date.
- Coverage history is append-only.
- Streetlight stays deterministic and AI-free.
- Reuse the existing shared `/` map, coverage derivation, packet geometry, and sidebar styles.
- Add no dependency.

---

### Task 1: Transactional reconciliation model

**Files:**
- Create: `web/db/migrations/018_reconciliation.sql`
- Create: `web/lib/reconciliation.ts`
- Create: `web/lib/reconciliation.test.ts`
- Modify: `web/lib/coverage.ts`
- Modify: `web/lib/coverage.test.ts`
- Modify: `web/lib/database.ts`
- Modify: `web/package.json`

**Interfaces:**
- Produce: `getReconciliationWorkspace(filename?): ReconciliationWorkspace`
- Produce: `reconcilePacketBatch(input, options?): ReconciliationWorkspace`
- Produce: `correctPacketCompletion(input, options?): ReconciliationWorkspace`
- Produce: exact request parsers and `ReconciliationConflictError`

- [x] **Step 1: Write failing tests for the data contract**

```ts
assert.deepEqual(parseReconciliationInput(valid), valid);
assert.throws(() => parseReconciliationInput(inexact), /Invalid reconciliation request/);
assert.equal(workspace.defaultBatchId, newestActiveBatchId);
```

Add real temporary-database cases proving missing packets complete once, present packets stay
active, cancelled packets release, street and apartment roots share one completion group, stale
requests roll back, correction changes every target, and conflicting undo changes nothing.

- [x] **Step 2: Run the focused test and verify RED**

Run: `node --experimental-strip-types --test lib/reconciliation.test.ts`  
Expected: FAIL because the migration and reconciliation boundary do not exist.

- [x] **Step 3: Add the minimum schema and database operations**

```ts
export function reconcilePacketBatch(
  input: ReconciliationInput,
  options?: { filename?: string; now?: Date },
): ReconciliationWorkspace;

export function correctPacketCompletion(
  input: PacketCompletionCorrectionInput,
  options?: { filename?: string; now?: Date },
): ReconciliationWorkspace;
```

Rebuild `coverage_events` with exactly one street/apartment target plus nullable `packet_id` and
`completion_group_id`. Preserve existing rows and append-only invariants. Confirm, correct, undo,
reservation checks, and batch-status recomputation each use one `BEGIN IMMEDIATE` transaction.

- [x] **Step 4: Expose apartment heatmap history and packet-managed roots**

Add `packetId` to derived coverage roots, derive apartment coverage separately with the existing
coverage functions, and prevent Coverage from treating packet-managed roots as single-segment
corrections.

- [x] **Step 5: Run focused and existing coverage/database tests**

Run: `node --experimental-strip-types --test lib/reconciliation.test.ts lib/coverage.test.ts db/database.test.mjs`  
Expected: PASS.

### Task 2: Reconciliation API boundary

**Files:**
- Create: `web/app/api/reconciliation/route.ts`
- Create: `web/app/api/reconciliation/route.test.ts`
- Modify: `web/package.json`

**Interfaces:**
- `GET /api/reconciliation` returns the workspace without writes.
- `POST /api/reconciliation` confirms one reviewed inventory.
- `PATCH /api/reconciliation` corrects or undoes one completed packet.

- [x] **Step 1: Write failing route tests**

```ts
assert.equal((await GET()).status, 200);
assert.equal((await POST(confirmRequest)).status, 200);
assert.equal((await POST(staleRequest)).status, 409);
assert.equal((await PATCH(correctionRequest)).status, 200);
```

Also prove malformed requests return `400`, missing packets return `404`, and database failures
return a generic `500` without leaking details.

- [x] **Step 2: Run the route test and verify RED**

Run: `node --experimental-strip-types --test app/api/reconciliation/route.test.ts`  
Expected: FAIL because the route does not exist.

- [x] **Step 3: Implement the thin route**

Parse with `web/lib/reconciliation.ts`, call the database boundary, map conflicts to `409`, and
return no trusted client-supplied coverage date.

- [x] **Step 4: Run the route tests**

Run: `node --experimental-strip-types --test app/api/reconciliation/route.test.ts`  
Expected: PASS.

### Task 3: Apartment proposals occupy requested slots

**Files:**
- Modify: `web/lib/packet-selection.ts`
- Modify: `web/lib/packet-selection.test.ts`
- Modify: `web/lib/database.ts`
- Modify: `web/lib/batch-finalization.test.ts`

**Interfaces:**
- `ApartmentPacketCandidate` gains `coverageClass` and `lastCoveredOn`.
- `generatePacketProposals()` compares street and apartment candidates by coverage age, then tract
  fit, and never returns more proposals than requested slots.

- [x] **Step 1: Replace the old append behavior with failing founder-rule tests**

```ts
assert.equal(result.proposals.length, requestedQuantity);
assert.equal(result.proposals[0].apartmentId, 'old-apartment');
assert.equal(result.proposals.some((packet) => packet.apartmentId === 'recent-apartment'), false);
```

Cover an atomic estimate outside the ±30% range and require a visible warning.

- [x] **Step 2: Run packet-selection tests and verify RED**

Run: `node --experimental-strip-types --test lib/packet-selection.test.ts lib/batch-finalization.test.ts`  
Expected: FAIL because apartments are currently appended after every requested street packet.

- [x] **Step 3: Integrate apartments into the existing slot loop**

Reuse the current coverage-age comparison and target slots. Choose the oldest viable candidate;
within equal age, use tract fit and existing stable ties. Consume one slot per apartment and retain
its requested target separately from its estimated tracts.

- [x] **Step 4: Run packet and finalization tests**

Run: `node --experimental-strip-types --test lib/packet-selection.test.ts lib/batch-finalization.test.ts`  
Expected: PASS.

### Task 4: Shared-map reconciliation tool and phase evidence

**Files:**
- Create: `web/components/ReconciliationTool.tsx`
- Modify: `web/components/StreetlightWorkspace.tsx`
- Modify: `web/components/CoverageMap.tsx`
- Modify: `web/components/CoverageDashboard.tsx`
- Modify: `web/app/globals.css`
- Modify: `IMPLEMENTATION_PLAN.md`

**Interfaces:**
- Add `reconciliation` to `WorkspaceTool`.
- `ReconciliationTool` owns its loaded workspace, selected batch/packet, present/cancel sets, review
  step, API mutations, and Google overlay cleanup.
- Successful mutations call the existing `refreshCoverage()`.

- [ ] **Step 1: Write and verify a failing preview-state test**

In `web/lib/reconciliation.test.ts`, prove the pure preview helper returns `complete`, `active`, and
`cancel` dispositions from the checkbox sets and rejects cancellation of an unchecked packet.

Run: `node --experimental-strip-types --test lib/reconciliation.test.ts`  
Expected: FAIL until the helper exists.

- [ ] **Step 2: Implement the fourth tool**

Render all active packets over the heatmap: missing green, present blue, cancel gray. Start with
every checkbox clear, include Select all/Clear selection, focus a selected row tightly, and show a
starting marker only for that selection. The confirmation groups all three dispositions and uses
the server date.

- [ ] **Step 3: Complete history and correction UI**

Keep completed/cancelled rows in the batch history. Completed packets expose whole-packet date and
undo actions; Coverage shows packet-managed history with a link-style instruction to use
Reconcile packets rather than per-segment controls.

- [ ] **Step 4: Run all automated verification**

Run: `pnpm test`  
Run: `pnpm typecheck`  
Run: `pnpm lint`  
Run: `pnpm build`  
Run: `python -m unittest importer.test_overture_import`  
Run: `git diff --check`  
Expected: all PASS.

- [ ] **Step 5: Browser and phase checkpoint**

Use an isolated temporary/demo database to confirm missing, kept, cancelled, corrected, undone,
conflicting, and apartment packets on `/`. Update Phase 6 status/evidence in
`IMPLEMENTATION_PLAN.md`, then stop for founder review.
