# Apartment Site Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the false one-building-equals-one-complex model with visible apartment evidence, confirmable multi-building sites, explicit packet readiness, and atomic apartment packets.

**Architecture:** Keep `apartment_complexes` as the durable packet target so historical packet and coverage references remain valid. Extend each current row into an apartment-site record containing imported evidence members plus explicit configuration; Overture normalization produces source-boundary proposals and ungrouped candidates, while confirmed rows are cloned across import generations. One church-scoped route updates site membership and configuration, and Setup renders truthful site counts and map evidence without adding a second apartment tool.

**Tech Stack:** Python 3 importer and `unittest`, Overture GeoParquet through DuckDB, Next.js route handlers, React 19, TypeScript, SQLite, MapLibre GL, Node test runner, Biome.

## Global Constraints

- Streetlight remains deterministic and AI-free.
- Overture remains the only apartment data provider.
- Nearby buildings are never grouped solely by proximity.
- Every apartment candidate remains visible to administrators.
- All four readiness facts are required: confirmed grouping, confirmed address, positive tract quantity, and known access (`open` or `restricted`).
- Packet inclusion auto-saves independently and is disabled until readiness is complete.
- One included complex produces one atomic apartment packet; v1 does not split it.
- Imported footprint estimates do not control packet sizing.
- Existing packet and coverage history must retain valid apartment targets.
- Preserve the founder-reviewed Phase 9 sidebar and map behavior already present in the dirty worktree.

---

### Task 1: Import honest apartment evidence and source-boundary proposals

**Files:**
- Modify: `web/importer/overture_import.py`
- Modify: `web/importer/test_overture_import.py`
- Modify: `web/importer/run_benchmark.py`
- Modify: `web/lib/overture-import.ts`
- Modify: `web/lib/overture-import.test.ts`
- Modify: `web/lib/territory-import.ts`
- Modify: `web/lib/territory-import.test.ts`
- Modify: normalizer-version fixtures returned by `rg -l "normalizerVersion: 11" web`

**Interfaces:**
- Produces `ImportedApartmentEvidence` with `id`, `sourceId`, `address`, `position`, optional building geometry, `apartmentBuilding`, and `distinctUnits`.
- Produces `ImportedApartmentSite` with `id`, nullable `name`, nullable `address`, `position`, nullable source `boundary`, `groupingKind: 'source_boundary' | 'ungrouped'`, and a non-empty `members` array.
- `ImportedTerritoryInput.apartmentSites` replaces `apartmentComplexes`; `normalizerVersion` becomes `12`.

- [ ] **Step 1: Write failing Python grouping tests**

Add fixtures for an apartment land-use polygon and assert that two contained apartment buildings become one `source_boundary` site, while a nearby building outside it remains one `ungrouped` site. Assert that no site contains a footprint-derived operational tract quantity and that address-only five-unit evidence remains an ungrouped member.

- [ ] **Step 2: Run the focused Python tests and verify red**

Run: `python -m unittest importer.test_overture_import.NormalizeFeaturesTest.test_apartment_land_use_proposes_one_site importer.test_overture_import.NormalizeFeaturesTest.test_ungrouped_apartment_evidence_stays_separate`

Expected: FAIL because `normalize_features` does not accept land-use evidence and still emits `apartmentComplexes` with `estimatedTracts`.

- [ ] **Step 3: Implement the smallest importer model**

Add a `theme=base/type=land_use/*` bbox query selecting apartment-tagged residential polygons with `id`, `names`, `source_tags`, and geometry. Extract raw apartment evidence from current building/address logic, assign evidence to a polygon only when its marker lies inside that polygon, and emit remaining evidence individually. Do not add proximity clustering. Bump the normalizer and benchmark cache versions and thread the fourth downloaded collection through `main` and benchmark caches.

- [ ] **Step 4: Verify Python green**

Run: `python -m unittest importer.test_overture_import`

Expected: PASS.

- [ ] **Step 5: Write failing TypeScript parser tests**

Change the valid import fixture to `apartmentSites` and version `12`; include a source-boundary site with two complete members. Add malformed cases for empty members, duplicate evidence IDs, invalid grouping kind, malformed geometry, and any legacy top-level `apartmentComplexes` payload.

- [ ] **Step 6: Run the parser tests and verify red**

Run: `node --experimental-strip-types --test lib/overture-import.test.ts lib/territory-import.test.ts`

Expected: FAIL because the parser still requires version `11` and legacy complexes.

- [ ] **Step 7: Implement exact TypeScript parsing and verify green**

Parse only the new site/member shape, preserve complete polygon or multipolygon geometry, require globally unique member IDs, return `apartmentSites`, and make version `12` the freshness gate.

Run: `node --experimental-strip-types --test lib/overture-import.test.ts lib/territory-import.test.ts`

Expected: PASS.

### Task 2: Extend durable apartment sites without breaking history

**Files:**
- Create: `web/db/migrations/027_apartment_site_model.sql`
- Modify: `web/db/database.test.mjs`
- Modify: `web/lib/database.ts`
- Modify: `web/lib/coverage.ts`
- Modify: `web/lib/coverage.test.ts`

**Interfaces:**
- Extends `apartment_complexes` with `site_name`, `boundary_geojson`, `grouping_kind`, `grouping_confirmed`, `address_confirmed`, `confirmed_tracts`, `access_status`, `included_in_packets`, and `members_json`.
- Produces `ApartmentEvidence` and `ApartmentSite`; `TerritoryWorkspace.apartmentSites` replaces `apartmentComplexes`.
- Produces `apartmentSiteReady(site): boolean`, `saveApartmentSiteConfiguration(input, filename?)`, and `saveApartmentSiteMembership(input, filename?)`.

- [ ] **Step 1: Write a failing migration test**

Migrate a database containing a legacy apartment row and packet reference. Assert that the row becomes one ungrouped, unconfirmed, unknown-access, unincluded site with one JSON member, while the existing packet join still resolves the same physical apartment target.

- [ ] **Step 2: Run the migration test and verify red**

Run: `node --test db/database.test.mjs`

Expected: FAIL because migration `027` and the new columns do not exist.

- [ ] **Step 3: Add the compatibility migration**

Use `ALTER TABLE` additions with strict checks. Backfill `members_json` from each legacy row with SQLite JSON functions. Leave the legacy `review_status` and `estimated_tracts` columns in place for historical compatibility, but set all new inclusion flags to `0`; do not rebuild packet or coverage foreign keys.

- [ ] **Step 4: Verify the migration test green**

Run: `node --test db/database.test.mjs`

Expected: PASS.

- [ ] **Step 5: Write failing database behavior tests**

Cover these observable behaviors with a migrated temporary database:

- imported proposals appear as unconfirmed sites with their complete members;
- grouping selected evidence produces one confirmed site and removes consumed candidate markers;
- editing membership restores removed evidence as ungrouped candidates;
- all four required facts compute readiness;
- inclusion is rejected before readiness and succeeds replay-safely afterward;
- clearing a required fact automatically turns inclusion off;
- confirmed membership and configuration survive an import refresh;
- coverage events and reservations continue to resolve historical apartment rows.

- [ ] **Step 6: Run focused database tests and verify red**

Run: `node --experimental-strip-types --test db/database.test.mjs lib/coverage.test.ts`

Expected: FAIL on the missing site types and mutation functions.

- [ ] **Step 7: Implement the minimal database behavior**

Read site members from exact JSON, compute readiness in one shared function, and use transactions for configuration and grouping. For grouping edits, accept exact evidence member IDs, consume only current unconfirmed candidates, update the target site's member JSON and centroid, and recreate removed members as ungrouped current rows. During import refresh, clone confirmed rows into the new generation unchanged, insert new source proposals, and suppress overlapping unconfirmed evidence in the returned workspace.

- [ ] **Step 8: Verify database green**

Run: `node --experimental-strip-types --test db/database.test.mjs lib/coverage.test.ts`

Expected: PASS.

### Task 3: Expose exact church-scoped apartment mutations

**Files:**
- Modify: `web/app/api/territory/apartment/route.ts`
- Modify: `web/app/api/territory/apartment/route.test.ts`

**Interfaces:**
- `PATCH /api/territory/apartment` consumes the complete configuration `{ id, name, address, addressConfirmed, tractCount, accessStatus, groupingConfirmed, includedInPackets }`.
- `POST /api/territory/apartment` consumes `{ id: string | null, memberIds: string[] }`; null creates a site and a string edits an existing site's membership.
- Both return the refreshed `TerritoryWorkspace`.

- [ ] **Step 1: Replace route tests with failing configuration and grouping cases**

Assert exact-key validation, positive tract validation, known access values, address confirmation, four-fact readiness, inclusion rejection, inclusion invalidation, replay-safe grouping, unknown members, duplicate members, church isolation, and no mutation on failure.

- [ ] **Step 2: Run route tests and verify red**

Run: `node --experimental-strip-types --test app/api/territory/apartment/route.test.ts`

Expected: FAIL because the route only accepts `{ id, included }`.

- [ ] **Step 3: Implement the route with existing authenticated boundaries**

Keep `authenticatedRoute(..., true)`, parse the two request shapes without accepting extra keys, map domain validation to 400/404/409, and return 500 only for unexpected failures. Do not add a provider or service abstraction.

- [ ] **Step 4: Verify route green**

Run: `node --experimental-strip-types --test app/api/territory/apartment/route.test.ts`

Expected: PASS.

### Task 4: Reorient Setup around apartments and evidence grouping

**Files:**
- Modify: `web/lib/territory-client.ts`
- Modify: `web/lib/territory-client.test.ts`
- Modify: `web/lib/territory-map-style.ts`
- Modify: `web/lib/territory-map-style.test.ts`
- Modify: `web/lib/open-map-style.ts`
- Modify: `web/lib/open-map-style.test.ts`
- Modify: `web/components/OpenTerritoryMap.tsx`
- Modify: `web/components/TerritoryEditor.tsx`
- Modify: `web/components/StreetlightWorkspace.test.mjs`
- Modify: `web/app/globals.css`

**Interfaces:**
- Produces `apartmentSiteSummary(sites)` returning confirmed-complex and ungrouped-building counts.
- Map callbacks select sites normally and toggle evidence members in grouping mode.
- Configuration and membership mutations use the existing `readMutationResult` recovery contract.

- [ ] **Step 1: Write failing pure helper and UI checks**

Assert truthful counts, `Needs setup` versus `Packet ready` labels, disabled inclusion until all facts exist, source-boundary and selected-site marker appearances, expanded member geometry for grouping edits, and removal of `Apartment complexes`, `estimated tracts`, footprint-estimate copy, and legacy status language.

- [ ] **Step 2: Run focused tests and verify red**

Run: `node --experimental-strip-types --test lib/territory-client.test.ts lib/territory-map-style.test.ts lib/open-map-style.test.ts components/StreetlightWorkspace.test.mjs`

Expected: FAIL on legacy complex terminology and the missing grouping/configuration controls.

- [ ] **Step 3: Implement the Setup interaction**

Rename the section to **Apartments** and report `N complexes · M ungrouped buildings`. Preserve the existing search/list/back-link shell. Add a bounded grouping mode that expands evidence markers, lets map clicks toggle members, and submits one group/edit action. The selected site card shows source evidence, address confirmation, tract quantity, `Open`/`Restricted` access, computed readiness, and the auto-saving inclusion checkbox. Save text/number edits on blur and discrete controls on change; restore prior state on confirmed failure and require reload verification on uncertain responses.

- [ ] **Step 4: Add selected evidence and boundary overlays**

Publish member polygon/point GeoJSON and a source-boundary outline only for the selected or edited site. Keep ungrouped markers subdued, use the existing selected marker color behavior, and preserve clustering, keyboard-accessible sidebar controls, reduced-motion behavior, and road-selection interaction.

- [ ] **Step 5: Polish with existing design tokens and verify green**

Reuse the sidebar's existing pills, borders, spacing, checkbox, and operation-state styles. Do not create a nested tool switcher or new component library.

Run: `node --experimental-strip-types --test lib/territory-client.test.ts lib/territory-map-style.test.ts lib/open-map-style.test.ts components/StreetlightWorkspace.test.mjs`

Run: `pnpm typecheck`

Expected: PASS.

### Task 5: Generate atomic packets only from configured sites

**Files:**
- Modify: `web/lib/packet-selection.ts`
- Modify: `web/lib/packet-selection.test.ts`
- Modify: `web/lib/packet-finalization.ts`
- Modify: `web/lib/packet-finalization.test.ts`
- Modify: `web/lib/packet-pdf.ts`
- Modify: `web/lib/packet-pdf.test.ts`
- Modify: packet route fixtures that construct apartment candidates

**Interfaces:**
- `ApartmentPacketCandidate` uses `tractCount` and `accessStatus: 'open' | 'restricted'`.
- Apartment proposals and `DownloadPacket` preserve `accessStatus` through finalization.

- [ ] **Step 1: Write failing packet behavior tests**

Assert that unconfirmed, incomplete, or unincluded sites never become candidates; included sites use the administrator tract count rather than imported estimates; one site stays one proposal even outside target tolerance; and restricted access survives fingerprinting, finalization, download selection, and PDF rendering.

- [ ] **Step 2: Run packet tests and verify red**

Run: `node --experimental-strip-types --test lib/packet-selection.test.ts lib/packet-finalization.test.ts lib/packet-pdf.test.ts app/api/packet-proposals/route.test.ts app/api/packets/pdf/route.test.ts`

Expected: FAIL because packet candidates still use legacy readiness and estimated tracts.

- [ ] **Step 3: Thread confirmed packet facts through existing packet code**

Filter candidates with the shared readiness rule plus `includedInPackets`, map `confirmedTracts` to the existing proposal `estimatedHomes` display field, keep the current atomic selection branch, and add access metadata without changing street packets. Draw a compact restricted-access warning only on apartment PDFs.

- [ ] **Step 4: Verify packet green**

Run: `node --experimental-strip-types --test lib/packet-selection.test.ts lib/packet-finalization.test.ts lib/packet-pdf.test.ts app/api/packet-proposals/route.test.ts app/api/packets/pdf/route.test.ts`

Expected: PASS.

### Task 6: Align product authority and perform full verification

**Files:**
- Modify: `PRODUCT.md`
- Modify: `IMPLEMENTATION_PLAN.md`
- Modify: `DESIGN.md` only where its apartment terminology conflicts with the approved model

**Interfaces:**
- Product authority uses apartment evidence, site, grouping, readiness, and inclusion exactly as defined in the design spec.
- Phase 9 remains at its founder-review checkpoint with fresh implementation evidence.

- [x] **Step 1: Update durable product rules**

Replace the probable-complex and footprint-sizing rules with the approved evidence/site model, all four readiness facts, independent inclusion, and one atomic configured-complex packet. Record Coverage presentation and complex splitting as explicitly deferred.

- [x] **Step 2: Update Phase 9 evidence without advancing the checkpoint**

Record focused test commands, the full verification commands, and the signed-in localhost scenarios. Do not mark Phase 9 complete.

- [x] **Step 3: Run the complete importer and web checks**

Run: `python -m unittest importer.test_overture_import`

Run: `pnpm test`

Run: `pnpm typecheck`

Run: `pnpm lint`

Run: `git diff --check`

Expected: all tests and typecheck pass; Biome exits zero with only explicitly retained repository warnings; no whitespace errors.

- [x] **Step 4: Run a bounded signed-in localhost pass**

In the in-app browser at `http://localhost:3000/`, verify:

- Setup says **Apartments** and distinguishes complexes from ungrouped buildings;
- all apartment evidence remains visible;
- source proposals and manual multi-building grouping show one primary marker;
- editing membership updates member highlighting;
- inclusion remains disabled until all four facts are present;
- configuration and inclusion persist without enabling Region Save;
- an included restricted complex carries its warning into a generated apartment packet;
- the sidebar fits without horizontal clipping at desktop and narrow widths.

- [ ] **Step 5: Commit the completed Phase 9 apartment model**

Stage only the files belonging to this implementation and the already-reviewed overlapping apartment/sidebar changes. Leave unrelated dirty files untouched.

Run: `git commit -m "feat: model apartment sites explicitly"`
