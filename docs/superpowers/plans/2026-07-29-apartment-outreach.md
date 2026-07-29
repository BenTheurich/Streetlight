# Apartment Outreach Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect, review, packet, and persist apartment complexes separately from street segments.

**Architecture:** Extend the existing Overture import contract with aggregate apartment complexes,
persist them beside street segments, and include ready complexes as distinct packet proposals.
Reuse the existing territory, batch, PDF, and map flows; do not create a second application path.

**Tech Stack:** Python importer and `unittest`; SQLite migrations; TypeScript, React, Google Maps,
Node test runner, and `pdf-lib`.

## Global Constraints

- Deterministic and AI-free.
- Explicit apartment buildings always qualify; address-only premises require five distinct units.
- Unit identifiers are counted during import but never persisted.
- Apartment estimates are displayed as estimates and cannot be edited.
- `needs_review` and `deferred` complexes are tracked but not packet-eligible.
- Every `ready` complex produces one atomic apartment packet.

---

### Task 1: Apartment import contract

**Files:**
- Modify: `web/importer/test_overture_import.py`
- Modify: `web/importer/overture_import.py`
- Modify: `web/lib/overture-import.test.ts`
- Modify: `web/lib/overture-import.ts`

**Interfaces:**
- Produces: `apartmentComplexes[]` with stable ID, address, position, estimated tracts, and evidence.

- [x] Add a failing importer test proving explicit apartment classification, five-unit detection,
  four-unit rejection, aggregate estimates, and no street double-count.
- [x] Run the focused Python test and confirm the missing output fails.
- [x] Implement the minimum grouping and import serialization.
- [x] Run the Python importer suite.
- [x] Add and fail the TypeScript contract test, then accept only the complete apartment contract.

### Task 2: Persistence and review states

**Files:**
- Create: `web/db/migrations/016_apartment_complexes.sql`
- Modify: `web/db/database.test.mjs`
- Modify: `web/lib/database.ts`
- Modify: `web/app/api/territory/route.ts`

**Interfaces:**
- Produces: persisted `needs_review | ready | deferred` complexes in territory and coverage
  workspaces; consumes apartment import output from Task 1.

- [x] Add a failing migration/import test for default state, reimport preservation, retirement,
  and exact state updates.
- [x] Run the database test and confirm the missing schema/behavior fails.
- [x] Add the smallest schema and replacement/update queries.
- [x] Add request validation for state changes to the existing territory save flow.
- [x] Run focused database and route tests.

### Task 3: Map and territory review

**Files:**
- Create: `web/components/ApartmentComplexMap.tsx`
- Modify: `web/components/StreetlightWorkspace.tsx`
- Modify: `web/components/TerritoryEditor.tsx`
- Modify: `web/app/globals.css`

**Interfaces:**
- Consumes: apartment complexes from Task 2.
- Produces: selectable amber, blue, and gray markers plus the three-state editor.

- [x] Add a failing pure appearance test for the three review states.
- [x] Implement one marker component using the existing Google map instance.
- [x] Add the Apartment complex sidebar section with address, estimated-tract label, evidence,
  and state controls.
- [x] Run focused tests, lint, and typecheck.

### Task 4: Separate apartment packets

**Files:**
- Modify: `web/lib/packet-selection.test.ts`
- Modify: `web/lib/packet-selection.ts`
- Modify: `web/lib/packet-finalization.test.ts`
- Modify: `web/lib/packet-finalization.ts`
- Modify: `web/lib/database.ts`
- Modify: `web/components/PacketGenerator.tsx`
- Modify: `web/components/PacketProposalMap.tsx`
- Modify: `web/lib/packet-pdf.test.ts`
- Modify: `web/lib/packet-pdf.ts`

**Interfaces:**
- Produces: `street` and `apartment` packet proposals in one reviewed batch.
- Persists: one apartment reservation per apartment packet.

- [x] Add a failing selection test proving every ready unreserved complex becomes one additional
  proposal while needs-review, deferred, and reserved complexes do not.
- [x] Implement the proposal union and deterministic ordering.
- [x] Add failing finalization/database tests proving exact reservation and stale-proposal rejection.
- [x] Persist apartment packet links and expose them in download selections.
- [x] Add failing PDF tests for a marker-only focused map and estimated-apartment-tract label.
- [x] Implement map/PDF rendering and packet review copy.
- [x] Run all packet tests.

### Task 5: Benchmark correctness and verification

**Files:**
- Modify: `web/importer/test_overture_import.py`
- Modify: `web/importer/overture_import.py`
- Modify: `web/importer/run_benchmark.py`
- Modify: `IMPLEMENTATION_PLAN.md`
- Create: `docs/benchmarks/2026-07-29-overture-nad-v9.md`

**Interfaces:**
- Produces: premise-deduplicated count metrics and exact failure diagnostics.

- [x] Add a failing benchmark test where hundreds of repeated points with five house numbers count
  as five premises.
- [x] Implement premise deduplication and diagnostic fields without changing import assignment.
- [x] Run five refreshed holdouts and record literal results.
- [x] Run Python tests, Node tests, lint, typecheck, production build, and `git diff --check`.
- [x] Update phase status and evidence with the benchmark outcome.
