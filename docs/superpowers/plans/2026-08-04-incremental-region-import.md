# Incremental Region Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reuse compatible normalized region data and import only newly covered geographic rectangles.

**Architecture:** Add pure bounding-box subtraction and normalized-result merging helpers, extend the importer CLI to accept explicit rectangles, and route compatible overlapping saves through them. Keep `saveTerritoryDraft` as the sole atomic generation replacement boundary.

**Tech Stack:** TypeScript, Node test runner, Python stdlib, DuckDB importer, SQLite.

## Global Constraints

- Preserve coverage history, exclusions, hidden/manual roads, apartment reviews, and the last saved region on failure.
- Avoid duplicate streets and buildings across overlap.
- Keep the existing import progress and recovery UX.
- Do not add dependencies, raw-feature persistence, a job queue, or unrelated UI polish.

---

### Task 1: Import-footprint planning

**Files:**
- Modify: `web/lib/territory-import.ts`
- Test: `web/lib/territory-import.test.ts`

**Interfaces:**
- Produces: `planTerritoryImport(imported, draft)` returning `none`, `full`, or `incremental` with explicit bounding boxes.

- [ ] Write failing tests for expansion strips, overlap recentering, contained shrinking, and disjoint fallback.
- [ ] Run `pnpm --dir web exec tsx --test lib/territory-import.test.ts` and confirm the new tests fail because the planner is absent.
- [ ] Implement the minimum latitude-aware box subtraction.
- [ ] Re-run the focused test and confirm it passes.

### Task 2: Rectangle importer contract and normalized merge

**Files:**
- Modify: `web/lib/overture-import.ts`
- Modify: `web/importer/overture_import.py`
- Test: `web/lib/overture-import.test.ts`
- Test: `web/importer/test_overture_import.py`

**Interfaces:**
- Produces: explicit-bounds importer arguments and `mergeImportedTerritories(current, additions, target)`.

- [ ] Write failing tests for explicit bounds and overlap deduplication of segments, addresses, apartments, and buildings.
- [ ] Run the focused TypeScript and Python importer tests and confirm expected failures.
- [ ] Add explicit bounds to the existing Python download/query path and TypeScript process wrapper.
- [ ] Implement stable normalized merging with no new dependency.
- [ ] Re-run focused importer tests and confirm they pass.

### Task 3: Route and atomic replacement integration

**Files:**
- Modify: `web/lib/database.ts`
- Modify: `web/app/api/territory/route.ts`
- Test: `web/db/database.test.mjs`
- Test: `web/app/api/territory/route.test.ts`

**Interfaces:**
- Consumes: import plan, current normalized generation, rectangle imports, normalized merge.
- Produces: unchanged API response and save transaction behavior.

- [ ] Write failing route/database tests proving incremental expansion, recenter fallback, state preservation, and import failure recovery.
- [ ] Run focused tests and confirm expected failures.
- [ ] Expose the current normalized generation from the database and execute the plan before the existing atomic save.
- [ ] Re-run focused tests and confirm they pass.

### Task 4: Verification and Phase 9 evidence

**Files:**
- Modify: `IMPLEMENTATION_PLAN.md`

- [ ] Run the complete Node and Python suites, formatter/linter, TypeScript check, and production build.
- [ ] Record exact results and the incremental-import behavior under Phase 9 evidence without changing unrelated phase scope.
- [ ] Review the final diff for unrelated changes and leave the Phase 9 human-review checkpoint intact.
