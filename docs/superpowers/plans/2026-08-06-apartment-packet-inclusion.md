# Apartment Packet Inclusion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace apartment review statuses with one default-off, independently auto-saved packet-inclusion checkbox.

**Architecture:** Keep the existing database enum as a compatibility detail: `ready` is included and every other value is not included. A dedicated authenticated endpoint updates one current complex in the active church workspace and returns the refreshed territory workspace. Region drafts stop carrying apartment statuses, while the Setup checkbox applies an optimistic local update, confirms it through the endpoint, and rolls back on failure.

**Tech Stack:** Next.js route handlers, React 19, TypeScript, SQLite, Node test runner, Biome.

## Global Constraints

- Imported apartment complexes are not included by default.
- Inclusion requires a usable starting address.
- Apartment inclusion saves independently from Region Save and Cancel.
- A confirmed failure restores the prior checkbox value; an uncertain result requires reload verification.
- Do not add a schema migration or expose the legacy three-state status in product copy.

---

### Task 1: Church-scoped apartment inclusion endpoint

**Files:**
- Create: `web/app/api/territory/apartment/route.ts`
- Create: `web/app/api/territory/apartment/route.test.ts`
- Modify: `web/lib/database.ts`
- Modify: `web/package.json`

**Interfaces:**
- Consumes: current `workspaceChurchId()`, `workspaceTerritoryId()`, `openWorkspaceDatabase()`, and `getTerritoryWorkspace()` database boundaries.
- Produces: `setApartmentPacketIncluded(id: string, included: boolean, filename?: string): TerritoryWorkspace` and `PATCH /api/territory/apartment` with `{ id: string, included: boolean }`.

- [ ] **Step 1: Write the failing route tests**

Add tests that call the exported route function inside `withTemeculaWorkspace`, using a temporary migrated and seeded database. Assert that an exact `{ id, included: true }` request changes an addressed complex to `ready`, `{ included: false }` changes it to `deferred`, repeated values remain successful, an addressless complex cannot be included, unknown IDs fail, and extra or malformed request fields return 400 without mutation.

- [ ] **Step 2: Run the route test to verify it fails**

Run: `node --experimental-strip-types --test app/api/territory/apartment/route.test.ts`

Expected: FAIL because the route and database mutation do not exist.

- [ ] **Step 3: Implement the minimal database mutation and route**

Implement one SQLite transaction that selects the current complex inside the active church and territory, rejects a missing complex, rejects `included: true` when `address` is null, and writes `ready` or `deferred`. Parse exactly two request keys, map known input problems to 400/404, return the refreshed workspace, and wrap the exported `PATCH` handler with `authenticatedRoute(..., true)`.

- [ ] **Step 4: Add the route test to the existing test script and verify green**

Run: `node --experimental-strip-types --test app/api/territory/apartment/route.test.ts`

Expected: PASS.

### Task 2: Auto-saved inclusion checkbox

**Files:**
- Modify: `web/lib/territory-client.ts`
- Modify: `web/lib/territory-map-style.ts`
- Modify: `web/lib/territory-map-style.test.ts`
- Modify: `web/components/TerritoryEditor.tsx`
- Modify: `web/components/StreetlightWorkspace.test.mjs`
- Modify: `web/app/globals.css`

**Interfaces:**
- Consumes: `readMutationResult()`, `isTerritoryWorkspacePayload()`, the new route, and `onSaved(workspace, false)`.
- Produces: `apartmentIncludedInPackets(reviewStatus)` and `withApartmentPacketInclusion(workspace, id, included)` helpers; a checkbox labeled `Include in packet generation`.

- [ ] **Step 1: Write failing behavior and UI checks**

Assert that the client helper maps only `ready` to included and returns an updated workspace without mutating the original. Update the Setup source check to require one checkbox and the autosave route, require the missing-address explanation and retry/reload actions, and reject `Outreach status`, `Needs review`, `Ready`, `Deferred`, and apartment draft mutations. Update option-label tests to expect `Included` or `Not included` instead of legacy statuses.

- [ ] **Step 2: Run focused tests to verify red**

Run: `node --experimental-strip-types --test lib/territory-map-style.test.ts components/StreetlightWorkspace.test.mjs`

Expected: FAIL on the old status label, radios, and draft behavior.

- [ ] **Step 3: Implement the checkbox and optimistic autosave**

Remove apartment statuses from `territoryDraftFromWorkspace()` and derive displayed apartments directly from the saved workspace. Replace the radio fieldset with one checkbox. On change, snapshot the current workspace, apply the desired local value, disable the checkbox, call the new endpoint through `readMutationResult`, accept the returned workspace on success, and restore the snapshot on rejected or uncertain responses. Render an inline `OperationStatus` with `Try again` for confirmed failure or `Reload to verify` for uncertain state. Disable inclusion without an address and explain why.

- [ ] **Step 4: Remove legacy status language from the apartment list**

Make option labels and visible list metadata say `Included` or `Not included`, retain address/nearby-road disambiguation, and sort by the visible label rather than the hidden legacy enum.

- [ ] **Step 5: Replace the three-column radio CSS with one 44px checkbox row**

Keep the existing pale-blue selected apartment card. Add one left-aligned checkbox row with a 20px native control, clear label, muted explanatory copy, and an inline error state; delete the segmented radio styles.

- [ ] **Step 6: Run focused tests and typecheck**

Run: `node --experimental-strip-types --test lib/territory-map-style.test.ts components/StreetlightWorkspace.test.mjs`

Run: `pnpm typecheck`

Expected: PASS.

### Task 3: Product authority and full verification

**Files:**
- Modify: `PRODUCT.md`
- Modify: `IMPLEMENTATION_PLAN.md`

**Interfaces:**
- Consumes: the approved founder decision and completed implementation.
- Produces: durable product rules and Phase 9 evidence matching the shipped behavior.

- [ ] **Step 1: Update product rules**

Replace the three apartment review-state bullets with: complexes start excluded from packet generation; inclusion is an auto-saved boolean; inclusion requires a usable starting address; included complexes generate atomic apartment packets; excluded complexes remain visible and can be included later.

- [ ] **Step 2: Update Phase 9 evidence**

Record the one-checkbox, default-off, independent-autosave behavior and its verification results without changing Phase 9's founder-review status.

- [ ] **Step 3: Run the complete checks**

Run: `pnpm test`

Run: `pnpm typecheck`

Run: `pnpm lint`

Run: `git diff --check`

Expected: all tests and typecheck pass; Biome exits zero with only the repository's retained warnings; no whitespace errors.

- [ ] **Step 4: Perform one bounded localhost browser pass**

Open Setup, select an addressed and addressless apartment, toggle inclusion on and off, confirm the control saves without enabling Region Save, and verify rollback/recovery copy and horizontal fit at desktop and narrow widths.
