# Import Completeness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent unnamed residential streets and street-sized address clusters from disappearing silently during a Phase 2 Overture import.

**Architecture:** The Python normalizer infers a missing residential-road name from strong nearby-address consensus, assigns each in-circle address once, and rejects unresolved clusters before emitting JSON. The existing Node boundary validates compact quality metadata, and the existing atomic database save stores those counts with the import footprint.

**Tech Stack:** Python 3 standard library, DuckDB 1.5.5, Node.js 24 built-in SQLite, TypeScript 5.9, Next.js 16.2.

## Global Constraints

- Overture release remains exactly `2026-06-17.0`.
- Successful payloads use normalizer version exactly `2`; legacy or mismatched versions require a
  replacement import.
- `MAX_ADDRESS_DISTANCE_METERS` remains exactly `40`.
- Inference requires at least `3` nearby in-circle addresses and a unique canonical-name share of at least `0.8`.
- Three or more unassigned in-circle addresses with one canonical street name fail the import.
- Imported geometry and tract counts remain read-only; add no manual correction controls.
- Keep Streetlight deterministic and AI-free.
- Failed normalization or persistence preserves the complete previously saved workspace.

---

### Task 1: Infer unnamed residential roads and reject unresolved clusters

**Files:**
- Modify: `web/importer/overture_import.py`
- Modify: `web/importer/test_overture_import.py`

**Interfaces:**
- Produces: `normalize_features(roads, addresses, center=None, radius_miles=None) -> {"segments": list, "quality": dict}`
- Produces quality keys: `totalAddresses`, `assignedAddresses`, `inferredRoads`, `unmatchedAddresses`, `unresolvedClusters`
- The command-line JSON payload includes `normalizerVersion: 2` and `quality` beside `segments`.

- [ ] **Step 1: Add the Hillsdale regression and quality-gate tests**

Create synthetic unnamed `residential` road features shaped as four connected parts and 29
`HILLSDALE HEIGHTS` address points within 40 meters. Assert the inferred display name is
`Hillsdale Heights`, all addresses are assigned once, and quality reports one inferred source road
per unnamed source feature. Add focused tests proving two addresses do not infer, equal top counts
do not infer, three unresolved same-name addresses raise `ValueError`, and out-of-circle
addresses do not enter the gate.

- [ ] **Step 2: Run the focused Python tests and record RED**

Run:

```powershell
python -m unittest web.importer.test_overture_import.ImportCompletenessTest
```

Expected: failures because unnamed features are discarded and `normalize_features` returns only a
segment list.

- [ ] **Step 3: Implement the minimal deterministic inference and assignment flow**

Keep unnamed always-residential source roads until a pre-split inference pass. Canonicalize nearby
address names, require `count >= 3`, require `count / nearby_count >= 0.8`, choose the deterministic
raw spelling, then split and assign addresses through the existing nearest exact-name rule. Track
address identity by input index so one point increments one segment once. Raise one deterministic
`ValueError` listing unresolved canonical street names and counts.

- [ ] **Step 4: Emit segments and quality from the CLI**

Update the CLI call to pass the requested center/radius, then include `normalizerVersion: 2`, the
normalized `segments`, and `quality` in its existing compact JSON output. Do not retain raw
addresses.

- [ ] **Step 5: Run all importer tests and record GREEN**

Run:

```powershell
python -m unittest web.importer.test_overture_import
```

Expected: every Python test passes.

- [ ] **Step 6: Commit**

```powershell
git add web/importer/overture_import.py web/importer/test_overture_import.py
git commit -m "fix: recover unnamed residential streets"
```

### Task 2: Validate and persist import quality

**Files:**
- Create: `web/db/migrations/005_import_quality.sql`
- Modify: `web/lib/overture-import.ts`
- Modify: `web/lib/overture-import.test.ts`
- Modify: `web/lib/database.ts`
- Modify: `web/db/database.test.mjs`
- Modify: `web/components/TerritoryEditor.tsx`

**Interfaces:**
- Extends `ImportedTerritoryInput` with `quality: ImportQuality`.
- Extends `TerritoryImportMetadata` or the territory workspace import object with the four stored
  successful quality counts and `normalizerVersion`.
- Migration columns are nullable for pre-amendment imports and populated together on every new
  imported replacement.

- [ ] **Step 1: Add failing Node contract and database round-trip tests**

Assert the process parser rejects a normalizer version other than `2`, plus missing, extra,
negative, non-integer, or internally inconsistent quality values. Assert
`assignedAddresses + unmatchedAddresses === totalAddresses`,
`unresolvedClusters === 0`, and a complete payload round-trips all four stored counts. Extend the
existing import-decision tests so a legacy or mismatched normalizer version requires replacement.
Extend the failed-replacement test to prove the prior quality metadata survives rollback.

- [ ] **Step 2: Run focused tests and record RED**

Run:

```powershell
corepack pnpm --dir web test
```

Expected: failures for the missing `quality` contract and database columns.

- [ ] **Step 3: Add migration 005 and minimal TypeScript persistence**

Add nullable non-negative integer columns:

```sql
import_total_addresses
import_assigned_addresses
import_inferred_roads
import_unmatched_addresses
import_normalizer_version
```

Validate exact payload keys at the process boundary. Store the counts and exact version in the
existing import transaction, expose them from `getTerritoryWorkspace`, and include the version in
`needsTerritoryImport`.

- [ ] **Step 4: Show one compact quality line in Territory Setup**

Under the existing import metadata, render:

```text
Address match: {assigned} of {total} · {inferred} inferred road(s)
```

Render nothing for legacy proof/pre-amendment metadata. Add no controls.

- [ ] **Step 5: Run Node tests, lint, and typecheck**

Run:

```powershell
corepack pnpm --dir web test
corepack pnpm --dir web lint
corepack pnpm --dir web typecheck
```

Expected: all pass.

- [ ] **Step 6: Commit**

```powershell
git add web/db/migrations/005_import_quality.sql web/lib/overture-import.ts web/lib/overture-import.test.ts web/lib/database.ts web/db/database.test.mjs web/components/TerritoryEditor.tsx
git commit -m "feat: surface territory import quality"
```

### Task 3: Verify the genuine pilot import and close Phase 2

**Files:**
- Modify: `IMPLEMENTATION_PLAN.md`
- Modify: `README.md`
- Test: full repository plus genuine importer and local HTTP checks

**Interfaces:**
- Consumes the exact Nicolas Road center already stored in the local database.
- Produces recorded release/count/quality evidence and Phase 2 status `Complete`.

- [ ] **Step 1: Migrate the local database and run the genuine importer**

Run migration 005, then execute the importer for the stored center and current radius with the
bundled Python. The process must exit zero with `unresolvedClusters: 0`. Confirm Hillsdale Heights
is present, has 29 assigned homes across its inferred segments, and the payload contains no raw
address records.

- [ ] **Step 2: Persist through the real territory API**

Restart the local server with `STREETLIGHT_PYTHON` pointing to the bundled Python. Save the current
territory through `PATCH /api/territory`, wait for the long-running import, then `GET` the page/API
and confirm the quality counts, Hillsdale segments, radius, exclusions, and import timestamp
persist.

- [ ] **Step 3: Run the canonical repository check**

Run:

```powershell
corepack pnpm check
git diff --check
```

Expected: lint, typecheck, every Node and Python test, production build, and diff check pass.

- [ ] **Step 4: Update evidence and completion status**

Record genuine counts, assigned/total addresses, inferred-road count, Hillsdale regression, failure
behavior, and verification commands in `IMPLEMENTATION_PLAN.md`. Mark Phase 2 `Complete` because
the founder explicitly authorized Phase 3 to begin after approving the working page and delegated
the remaining import-quality implementation choices.

- [ ] **Step 5: Commit**

```powershell
git add IMPLEMENTATION_PLAN.md README.md
git commit -m "docs: complete territory setup phase"
```
