# Apartment V1 Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce apartment administration to address, tract quantity, access, and one inclusion choice while preserving optional building grouping and atomic apartment packets.

**Architecture:** Keep the existing apartment evidence, site, database, and packet model. Simplify the shared display helpers and Setup UI, then make the database derive the legacy confirmation columns from inclusion and membership actions. Do not add a migration, a second status model, or a new API route.

**Tech Stack:** TypeScript 5.9, React 19, Next.js 16, SQLite, Node's built-in test runner, Biome, Playwright browser checks.

## Global Constraints

- `PRODUCT.md` is the product authority; follow the founder-approved `Apartment V1 Simplification` design.
- Apartment evidence remains excluded from adjacent street tract estimates.
- Apartment sites default to **Not included**.
- The Setup interface exposes only **Not included** and **Included**; do not display `Needs setup`, `Packet ready`, review status, grouping confirmation, or address confirmation.
- Inclusion requires a nonempty starting address, a positive integer tract quantity, and explicit `Open` or `Restricted` access.
- Grouping remains an optional correction tool. Saving changed membership turns inclusion off.
- Apartment configuration continues to autosave independently from Region Setup Save and Cancel.
- One included apartment site remains one atomic packet and one reconciliation coverage unit.
- Keep the legacy confirmation and review-status database columns for compatibility; add no migration.
- Add no dependency, abstraction layer, new route, custom boundary drawing, packet splitting, or partial completion.

---

## File map

- `web/lib/territory-client.ts`: computes whether the three required packet facts are present and provides the Apartments section summary.
- `web/lib/territory-map-style.ts`: produces searchable apartment labels and the two visible inclusion states.
- `web/lib/database.ts`: persists configuration, derives legacy confirmation fields, invalidates inclusion after membership changes, and supplies packet candidates.
- `web/app/api/territory/apartment/route.ts`: retains the existing strict authenticated PATCH/POST boundary.
- `web/components/TerritoryEditor.tsx`: renders the simplified administrator flow and keeps optimistic autosave/recovery.
- `web/app/globals.css`: removes obsolete readiness styling and keeps the compact field layout.
- Focused tests live beside those responsibilities; no new test framework or fixture layer is needed.

### Task 1: Collapse shared readiness and display states

**Files:**
- Modify: `web/lib/territory-client.ts:5-18,94-107`
- Modify: `web/lib/territory-client.test.ts:4-10,118-133`
- Modify: `web/lib/territory-map-style.ts:100-220`
- Modify: `web/lib/territory-map-style.test.ts:16-129,253-320`

**Interfaces:**
- Produces: `apartmentSiteReady(site: Pick<ApartmentSite, 'address' | 'tractCount' | 'accessStatus'>): boolean`.
- Produces: `apartmentSiteSummary(sites: ApartmentSite[]): { siteCount: number; includedCount: number }`.
- Produces: `apartmentOptionLabel(...)` and `apartmentReviewOptions(...)` labels containing only `Included` or `Not included`.
- Consumed later by: `saveApartmentSiteConfiguration`, packet-candidate filtering, and `TerritoryEditor`.

- [ ] **Step 1: Write failing readiness and summary tests**

Replace the existing apartment summary test and add direct readiness assertions:

```ts
import {
  apartmentSiteReady,
  apartmentSiteSummary,
  // existing imports remain
} from './territory-client.ts';

test('apartment inclusion needs address, tract quantity, and access', () => {
  const complete = {
    address: '10 Main Street',
    tractCount: 24,
    accessStatus: 'open' as const,
  };
  assert.equal(apartmentSiteReady(complete), true);
  assert.equal(apartmentSiteReady({ ...complete, address: null }), false);
  assert.equal(apartmentSiteReady({ ...complete, tractCount: null }), false);
  assert.equal(apartmentSiteReady({ ...complete, accessStatus: 'unknown' }), false);
});

test('apartment summary reports sites and inclusion only', () => {
  assert.deepEqual(apartmentSiteSummary(workspace.apartmentSites), {
    siteCount: 1,
    includedCount: 0,
  });
  assert.deepEqual(
    apartmentSiteSummary([
      { ...workspace.apartmentSites[0], includedInPackets: true },
    ]),
    { siteCount: 1, includedCount: 1 },
  );
});
```

- [ ] **Step 2: Write failing apartment-label assertions**

Change the expected anonymous-site labels and add both inclusion states:

```ts
assert.equal(
  options[0]?.label,
  'Address unavailable near Main Street · Not included · Building 1',
);
assert.equal(
  apartmentOptionLabel({
    name: null,
    address: '10 Main Street',
    position: [0, 0],
    includedInPackets: true,
    members: [{ apartmentBuilding: true }],
  }),
  '10 Main Street · Included',
);
```

Remove `groupingConfirmed` and `packetReady` from the local `ApartmentReviewInput` test type because labels no longer use them.

- [ ] **Step 3: Run the focused tests and verify the old model fails**

Run:

```powershell
pnpm --dir web exec node --experimental-strip-types --test lib/territory-client.test.ts lib/territory-map-style.test.ts
```

Expected: failures show the old five-field readiness rule, `confirmedComplexes`/`ungroupedBuildings` summary, and `Needs setup`/`Packet ready` copy.

- [ ] **Step 4: Implement the minimal shared helpers**

Use only the three required facts:

```ts
export function apartmentSiteReady(
  site: Pick<ApartmentSite, 'address' | 'tractCount' | 'accessStatus'>,
): boolean {
  return Boolean(
    site.address?.trim() &&
      site.tractCount !== null &&
      site.tractCount >= 1 &&
      site.accessStatus !== 'unknown',
  );
}

export function apartmentSiteSummary(sites: ApartmentSite[]): {
  siteCount: number;
  includedCount: number;
} {
  return {
    siteCount: sites.length,
    includedCount: sites.filter(({ includedInPackets }) => includedInPackets).length,
  };
}
```

In `apartmentOptionLabel`, replace the nested readiness status with:

```ts
const status = apartment.includedInPackets ? 'Included' : 'Not included';
```

Keep nearby-road lookup, stable sorting, duplicate-building disambiguation, and search behavior unchanged.

- [ ] **Step 5: Run the focused tests and typecheck**

Run:

```powershell
pnpm --dir web exec node --experimental-strip-types --test lib/territory-client.test.ts lib/territory-map-style.test.ts
pnpm --dir web typecheck
```

Expected: both commands pass.

- [ ] **Step 6: Commit the shared behavior**

```powershell
git add web/lib/territory-client.ts web/lib/territory-client.test.ts web/lib/territory-map-style.ts web/lib/territory-map-style.test.ts
git commit -m "refactor: simplify apartment inclusion states"
```

### Task 2: Derive confirmations and invalidate changed groupings

**Files:**
- Modify: `web/lib/database.ts:2534-2598,2601-2748`
- Modify: `web/db/database.test.mjs:335-484`
- Modify: `web/app/api/territory/apartment/route.test.ts:69-167`
- Verify unchanged: `web/app/api/territory/apartment/route.ts`

**Interfaces:**
- Consumes: the three-fact `apartmentSiteReady` from Task 1.
- Preserves: the existing strict `ApartmentSiteConfigurationInput` PATCH body for compatibility; `name`, `addressConfirmed`, and `groupingConfirmed` remain accepted but no longer represent separate UI decisions.
- Produces: inclusion that implicitly sets legacy grouping/address confirmation and membership edits that always clear inclusion.
- Preserves: `ApartmentSiteMembershipInput = { id: string | null; memberIds: string[] }` and existing church-scoped transaction boundaries.

- [ ] **Step 1: Rewrite the database inclusion test around the V1 rule**

Replace `apartment grouping and all four confirmed facts control packet inclusion` with a test that configures one imported site directly:

```js
test('address, tract quantity, access, and inclusion control apartment packets', () => {
  withDatabase((filename) => {
    // Import apartments-10 using the existing fixture setup.
    const site = getTerritoryWorkspace(filename).apartmentSites[0];
    assert.throws(
      () =>
        saveApartmentSiteConfiguration(
          {
            id: site.id,
            name: site.name,
            address: '10 Sample Road, Temecula CA 92591',
            addressConfirmed: false,
            tractCount: 24,
            accessStatus: 'unknown',
            groupingConfirmed: false,
            includedInPackets: true,
          },
          filename,
        ),
      /address, tract quantity, and access/i,
    );

    const included = saveApartmentSiteConfiguration(
      {
        id: site.id,
        name: site.name,
        address: '10 Sample Road, Temecula CA 92591',
        addressConfirmed: false,
        tractCount: 24,
        accessStatus: 'restricted',
        groupingConfirmed: false,
        includedInPackets: true,
      },
      filename,
    ).apartmentSites[0];
    assert.equal(included.includedInPackets, true);
    assert.equal(included.groupingConfirmed, true);
    assert.equal(included.addressConfirmed, true);

    const invalidated = saveApartmentSiteConfiguration(
      {
        id: included.id,
        name: included.name,
        address: included.address,
        addressConfirmed: included.addressConfirmed,
        tractCount: null,
        accessStatus: included.accessStatus,
        groupingConfirmed: included.groupingConfirmed,
        includedInPackets: true,
      },
      filename,
    ).apartmentSites[0];
    assert.equal(invalidated.includedInPackets, false);
  });
});
```

- [ ] **Step 2: Add the membership-invalidation assertion**

In the existing membership-edit test, first include the group, then edit its member IDs and assert:

```js
const editedSite = edited.apartmentSites.find(({ id }) => id === group.id);
assert.ok(editedSite);
assert.equal(editedSite.includedInPackets, false);
assert.equal(editedSite.groupingConfirmed, true);
assert.equal(editedSite.tractCount, 12);
```

This proves the deliberate grouping survives while packet inclusion is withdrawn for review.

- [ ] **Step 3: Update the authenticated route test**

Keep the existing exact-key and church-isolation assertions. Change the successful configuration case so `addressConfirmed` and `groupingConfirmed` are false in the request while the returned included site has both legacy fields true. Change the missing-access conflict expectation to status `409`, and change the invalidation request to clear `tractCount` while replaying `includedInPackets: true`.

- [ ] **Step 4: Run focused tests and verify failure**

Run:

```powershell
pnpm --dir web exec node --experimental-strip-types --test db/database.test.mjs app/api/territory/apartment/route.test.ts
```

Expected: the old server rejects inclusion without client-supplied confirmations and preserves inclusion after membership edits.

- [ ] **Step 5: Make configuration derive the legacy fields**

Keep the existing transaction and strict validation. Build `next` from address, tract quantity, and access, then derive inclusion:

```ts
const next = {
  address: input.address?.trim() || null,
  tractCount: input.tractCount,
  accessStatus: input.accessStatus,
};
const ready = apartmentSiteReady(next);
if (input.includedInPackets && !ready && row.included_in_packets === 0) {
  throw new ApartmentSiteError(
    'not_ready',
    'Add an address, tract quantity, and access before including this apartment site',
  );
}
const included = input.includedInPackets && ready;
const groupingConfirmed = row.grouping_confirmed === 1 || included;
const addressConfirmed = Boolean(
  next.address &&
    (included || (row.address_confirmed === 1 && row.address === next.address)),
);
```

Persist `groupingConfirmed`, `addressConfirmed`, and `included`. Continue setting legacy
`review_status` to `ready` only when included and to `needs_review` otherwise. Preserve the stored
site name; the compatibility request field does not create a new user-facing naming workflow.

- [ ] **Step 6: Clear inclusion when membership changes**

In the existing-site membership `UPDATE`, add:

```sql
included_in_packets = 0,
review_status = 'needs_review',
```

Keep `grouping_confirmed = 1`, the saved tract quantity, address, access, restoration of removed evidence, member-conflict checks, and transaction behavior unchanged.

- [ ] **Step 7: Run focused and packet-boundary tests**

Run:

```powershell
pnpm --dir web exec node --experimental-strip-types --test db/database.test.mjs app/api/territory/apartment/route.test.ts lib/packet-selection.test.ts lib/batch-finalization.test.ts lib/reconciliation.test.ts
pnpm --dir web typecheck
```

Expected: all tests and typecheck pass; apartment packets remain atomic and restricted access still survives finalization.

- [ ] **Step 8: Commit the persistence behavior**

```powershell
git add web/lib/database.ts web/db/database.test.mjs web/app/api/territory/apartment/route.test.ts
git commit -m "refactor: derive apartment packet inclusion"
```

### Task 3: Simplify the Setup apartment card

**Files:**
- Modify: `web/components/TerritoryEditor.tsx:66-81,216-218,1080-1380`
- Modify: `web/components/StreetlightWorkspace.test.mjs:139-268`
- Modify: `web/app/globals.css:1710-1783,1860-1889`

**Interfaces:**
- Consumes: `{ siteCount, includedCount }`, three-fact `packetReady`, and the existing PATCH/POST routes.
- Preserves: `saveApartmentConfiguration`, `saveApartmentMembership`, optimistic workspace replacement, confirmed-failure rollback, uncertain-result reload recovery, map selection, and Back to list.
- Produces: one compact card with building count, edit action, address, tract quantity, access, and inclusion.

- [ ] **Step 1: Change the component contract test first**

Rename the source test to `apartment inclusion uses one choice after the three packet facts` and assert both presence and absence:

```js
assert.match(territory, /Primary entrance or address/);
assert.match(territory, /Tract quantity/);
assert.match(territory, /<option value="open">Open<\/option>/);
assert.match(territory, /<option value="restricted">Restricted<\/option>/);
assert.match(territory, /Include in packet generation/);
assert.match(territory, /Edit buildings/);
assert.doesNotMatch(territory, /Complex name/);
assert.doesNotMatch(territory, /Building grouping confirmed/);
assert.doesNotMatch(territory, /Primary entrance confirmed/);
assert.doesNotMatch(territory, /Needs setup/);
assert.doesNotMatch(territory, /Packet ready/);
```

Update the section-summary assertion to require `siteCount`, `includedCount`, `sites`, and `included`, and to reject the old `ungrouped` summary copy.

- [ ] **Step 2: Run the component test and verify old controls fail**

Run:

```powershell
pnpm --dir web exec node --experimental-strip-types --test components/StreetlightWorkspace.test.mjs
```

Expected: failures identify the complex-name field, confirmation checkboxes, old list states, and old section summary.

- [ ] **Step 3: Replace the Apartments section summary**

Render the stable site total first and inclusion second:

```tsx
<small className="review-disclosure-meta">
  {apartmentSummary.siteCount} {apartmentSummary.siteCount === 1 ? 'site' : 'sites'}
  <span aria-hidden="true"> · </span>
  {apartmentSummary.includedCount} included
</small>
```

- [ ] **Step 4: Remove the obsolete fields and states**

Delete the Complex name label/input and the complete `.apartment-readiness-checks` block. Keep the current heading identity fallback (`source name`, then address, then `Apartment site`) but render only:

```tsx
<span className={selectedApartment.includedInPackets ? 'included' : undefined}>
  {selectedApartment.includedInPackets ? 'Included' : 'Not included'}
</span>
```

Use the same two-state expression in list rows. On address blur, save only the address override; do not reset confirmation from the UI.

- [ ] **Step 5: Keep inclusion gated by the three facts**

Continue disabling the inclusion checkbox while saving or when `selectedApartment.packetReady` is false. Replace the old instruction with:

```tsx
{!selectedApartment.packetReady && (
  <small>Add a starting address, tract quantity, and access before including this site.</small>
)}
```

When inclusion is toggled on, send compatibility confirmations as true in the existing complete payload so optimistic state agrees immediately; the server remains authoritative:

```ts
apartmentConfiguration(selectedApartment, {
  includedInPackets: event.target.checked,
  groupingConfirmed: event.target.checked || selectedApartment.groupingConfirmed,
  addressConfirmed: event.target.checked || selectedApartment.addressConfirmed,
})
```

- [ ] **Step 6: Remove obsolete CSS and tighten the field grid**

Delete `.apartment-readiness-checks` rules and rename `.apartment-site-heading > span.ready` to `.apartment-site-heading > span.included`. With the name field gone, make only the address row span the grid:

```css
.apartment-configuration-fields label:first-child {
  grid-column: 1 / -1;
}
```

Keep the existing tract/access two-column layout, 42-pixel fields, inclusion control, focus treatment, narrow-width behavior, and themed scrollbars.

- [ ] **Step 7: Run focused UI and helper tests**

Run:

```powershell
pnpm --dir web exec node --experimental-strip-types --test components/StreetlightWorkspace.test.mjs lib/territory-client.test.ts lib/territory-map-style.test.ts app/api/territory/apartment/route.test.ts
pnpm --dir web typecheck
pnpm --dir web lint
```

Expected: all commands pass. Biome may retain the repository's already-documented informational warnings but must report no new errors.

- [ ] **Step 8: Commit the administrator flow**

```powershell
git add web/components/TerritoryEditor.tsx web/components/StreetlightWorkspace.test.mjs web/app/globals.css
git commit -m "feat: simplify apartment setup for v1"
```

### Task 4: Verify the complete workflow and update Phase 9 evidence

**Files:**
- Modify: `IMPLEMENTATION_PLAN.md:844-859`
- Verify: all files changed in Tasks 1-3

**Interfaces:**
- Consumes: the complete simplified flow.
- Produces: canonical automated evidence, signed-in browser evidence, and the Phase 9 founder-review checkpoint.

- [ ] **Step 1: Run the complete deterministic checks**

Run from the repository worktree root:

```powershell
pnpm --dir web test
python -m unittest discover -s web/importer -p "test_*.py"
pnpm --dir web lint
pnpm --dir web typecheck
pnpm --dir web build
git diff --check
```

Expected: Node tests, Python importer tests, typecheck, and production build pass; Biome reports no errors; `git diff --check` prints nothing. The importer is unchanged, but its suite proves apartment evidence still does not inflate street estimates.

- [ ] **Step 2: Start the local application and verify the two states**

Create an isolated review copy first so finalization cannot alter the founder's saved workspace,
then run the application against that exact copy:

```powershell
$reviewDatabase = (Join-Path (Resolve-Path 'web/data').Path 'apartment-v1-review.db')
Copy-Item -LiteralPath 'web/data/streetlight.db' -Destination $reviewDatabase
$env:STREETLIGHT_DATABASE_PATH = $reviewDatabase
pnpm --dir web dev
```

Using the signed-in localhost workspace, open Setup → Region → Apartments and verify:

1. The current fixture summary reads `74 sites · 0 included`; later data shows the corresponding
   live site count and included count in the same format.
2. Every list row says only `Not included` or `Included`.
3. Selecting a site shows buildings, Edit buildings, address, tract quantity, access, and inclusion—no name or confirmation fields.
4. Inclusion is unavailable until address, a positive tract quantity, and Open or Restricted access are present.
5. Enabling inclusion autosaves, changes the row/card to Included, survives reload, and preserves the selected map highlight.
6. Clearing tract quantity automatically changes the site to Not included.
7. Editing the included site's building membership also changes it to Not included while preserving its address, tract quantity, and access for review.
8. Re-enabling inclusion makes exactly one atomic apartment proposal; restricted access still appears on finalized packet output.
9. Back to list, apartment search, clustering, map selection, and autosave failure recovery remain functional.
10. At desktop, portrait tablet, and 390-pixel sidebar widths, controls do not clip or overlap either scrollbar gutter.

Because the browser uses the isolated review copy, packet finalization cannot mutate
`web/data/streetlight.db`. Stop the server after the check. Resolve the review path and confirm its
parent is exactly the worktree's `web/data` directory before removing only
`web/data/apartment-v1-review.db`.

- [ ] **Step 3: Record the completed evidence without changing phase order**

Replace the August 10 `pending Phase 9 revision` paragraph in `IMPLEMENTATION_PLAN.md` with:

```markdown
- The August 10 founder-approved apartment V1 simplification now exposes only Not included and
  Included. Address, positive tract quantity, and Open or Restricted access gate one auto-saved
  inclusion choice; inclusion accepts the current grouping and address, while later membership
  edits or invalid required values turn inclusion off. The legacy confirmation columns remain
  internal for migration and history compatibility.
- The complete Node and Python importer suites, Biome, TypeScript, production build, and whitespace
  check pass. A signed-in localhost pass covered the two visible states, three-field gating,
  autosave/reload, membership invalidation, one atomic apartment proposal, restricted-access
  output, map selection, and desktop/tablet/narrow sidebar fit without console errors.
```

Keep Phase 9 `In progress` and its founder-review checkpoint; do not begin Phase 10.

- [ ] **Step 4: Commit verification evidence**

```powershell
git add IMPLEMENTATION_PLAN.md
git commit -m "docs: record apartment v1 verification"
```

- [ ] **Step 5: Stop at founder review**

Report the automated results, browser states tested, the restored fixture state, and exact local URL. Ask the founder to inspect one not-included site, include it, edit its buildings, and confirm that the simplified flow feels sufficient for V1.
