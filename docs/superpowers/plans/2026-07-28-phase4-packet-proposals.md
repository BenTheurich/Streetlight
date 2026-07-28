# Phase 4 Deterministic Packet Proposals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate deterministic, read-only, mixed-size packet proposals from the saved territory,
coverage heatmap, assigned addresses, exclusions, and active reservations.

**Architecture:** Extend the existing pinned Overture import so current segment versions retain
their assigned address points. Add one pure TypeScript selector that processes heatmap ranges
oldest-first, expands outward from the church within a range, and grows connected prefixes for
mixed target sizes. Expose the derived result through one read-only API and a dedicated
map-dominant `/packets` page; do not write batch or reservation records in Phase 4.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, Node `node:sqlite`, Python Overture
normalizer, Google Maps JavaScript API, native HTML controls, Node test runner, Python `unittest`.

**Prerequisite:** Phase 3 is complete on `main` at `3d45e13`. The founder approved the Phase 4
design committed at `98ffb50`.

## Global Constraints

- Read `AGENTS.md`, `PRODUCT.md`, `IMPLEMENTATION_PLAN.md`, and
  `docs/superpowers/specs/2026-07-28-phase4-packet-proposals-design.md` before each task.
- Work only on Phase 4. Change its roadmap status to `In progress` when Task 1 begins and stop at
  `Awaiting human review`.
- Keep Streetlight deterministic and AI-free.
- Add no dependency, route optimizer, map-provider abstraction, manual packet editor, reservation
  write, PDF behavior, QR code, walking path, end point, or printed street list.
- A packet is connected; packets in one preview batch may be geographically scattered.
- Process heatmap ranges `red`, `orange`, `yellow`, `green`; within a range expand outward from the
  saved church center.
- Aim for plus or minus 20 percent, never split a segment, and retain the approved under- and
  oversized exceptions.
- Preserve the selected segment's first and last geometry coordinates.
- Identical database state, `asOf` date, thresholds, and request must return byte-equivalent JSON.
- Preview generation must not insert or update `batches`, `packets`, `packet_segments`, or
  `coverage_events`.
- Use existing Google Maps loading, map shell, SQLite access, coverage classification, and Overture
  import patterns before adding code.

---

### Task 1: Retain assigned starting-address evidence

**Files:**
- Create: `web/db/migrations/013_segment_addresses.sql`
- Modify: `IMPLEMENTATION_PLAN.md`
- Modify: `web/importer/overture_import.py`
- Modify: `web/importer/test_overture_import.py`
- Modify: `web/lib/overture-import.ts`
- Modify: `web/lib/overture-import.test.ts`
- Modify: `web/lib/territory-import.ts`
- Modify: `web/lib/territory-import.test.ts`
- Modify: `web/lib/database.ts`
- Modify: `web/db/database.test.mjs`

**Interfaces:**

- Consumes: the existing Overture release constant, normalized segment contract, versioned
  `street_segments`, and `saveTerritoryDraft`.
- Produces:

```ts
export type ImportedSegmentAddress = {
  number: string | null;
  street: string;
  locality: string | null;
  postcode: string | null;
  position: Position;
};

export type ImportedTerritorySegment = {
  id: string;
  sourceSegmentId: string;
  roadGroupId: string;
  roadClass: string;
  streetName: string;
  geometry: LineString;
  estimatedHomes: number;
  activationKind: 'automatic' | 'hidden';
  addresses: ImportedSegmentAddress[];
};

// ImportedTerritoryInput.normalizerVersion is exactly 5.
```

- Database table:

```sql
CREATE TABLE segment_addresses (
  id INTEGER PRIMARY KEY,
  street_segment_id TEXT NOT NULL REFERENCES street_segments(id) ON DELETE CASCADE,
  house_number TEXT,
  street TEXT NOT NULL CHECK (length(trim(street)) > 0),
  locality TEXT,
  postcode TEXT,
  longitude REAL NOT NULL,
  latitude REAL NOT NULL
) STRICT;

CREATE INDEX segment_addresses_segment
ON segment_addresses (street_segment_id);
```

- [x] **Step 1: Mark Phase 4 in progress and write failing Python address tests**

Change only the Phase 4 status-table cell from `Pending` to `In progress`.

Extend the Python `address` test helper to accept `number`, `postal_city`, `postcode`, and
`address_levels`. Add a test whose named road has one complete address and one address without a
number:

```python
def test_preserves_assigned_address_components_without_units(self):
    roads = [road("road-1", "residential", "Sample Road", [[0, 0], [0.001, 0]])]
    addresses = [
        address(
            "Sample Road",
            0.00025,
            0.00005,
            number="10",
            postal_city="Temecula",
            postcode="92591",
            address_levels=[{"value": "California"}, {"value": "Temecula"}],
        ),
        address(
            "Sample Road",
            0.00075,
            0.00005,
            number=None,
            postal_city=None,
            postcode=None,
            address_levels=[{"value": "California"}, {"value": "Murrieta"}],
        ),
    ]

    segment = normalize_features(roads, addresses)["segments"][0]
    self.assertEqual(segment["estimatedHomes"], 2)
    self.assertEqual(
        segment["addresses"],
        [
            {
                "number": "10",
                "street": "Sample Road",
                "locality": "Temecula",
                "postcode": "92591",
                "position": [0.00025, 0.00005],
            },
            {
                "number": None,
                "street": "Sample Road",
                "locality": "Murrieta",
                "postcode": None,
                "position": [0.00075, 0.00005],
            },
        ],
    )
```

Extend the DuckDB query test to require `number`, `postal_city`, `postcode`, and
`address_levels` in the address `SELECT`. Run:

```powershell
python -m unittest discover -s web/importer -p "test_*.py"
```

Expected: FAIL because normalized segments do not expose addresses and the query selects only
`street`.

- [x] **Step 2: Extend the Python importer with the minimum address fields**

Build each `footprint_addresses` item with:

```python
levels = address_feature["properties"].get("address_levels") or []
locality = (
    address_feature["properties"].get("postal_city")
    or next(
        (
            level.get("value")
            for level in reversed(levels)
            if level and level.get("value")
        ),
        None,
    )
)
```

When assigning an address to its nearest same-name segment, keep the existing count and append:

```python
nearest["addresses"].append(
    {
        "number": address_item["number"],
        "street": address_item["street"],
        "locality": address_item["locality"],
        "postcode": address_item["postcode"],
        "position": address_item["point"],
    }
)
```

Initialize every normalized segment with `"addresses": []`, emit that array beside
`estimatedHomes`, sort addresses by `(street.casefold(), number or "", postcode or "", position)`,
and change output `normalizerVersion` from `4` to `5`.

Change the address query to:

```sql
SELECT number, street, postal_city, postcode, address_levels, ST_AsGeoJSON(geometry)
FROM read_parquet('{path}', hive_partitioning = true)
WHERE street IS NOT NULL AND {bbox_filter}
```

Return those exact properties and continue omitting `unit`. Run the Python suite again; expected:
PASS.

- [x] **Step 3: Write failing TypeScript parser and import-refresh tests**

Add one complete and one numberless address to `validOutput.segments[0].addresses`. Assert parsed
positions and nullable fields survive unchanged. Add invalid outputs for:

```ts
[
  { ...address, position: [-181, 33.5] },
  { ...address, street: '' },
  { ...address, number: 42 },
  { ...address, locality: 5 },
  { ...address, postcode: false },
]
```

Assert an output missing `addresses`, containing an extra address key, or reporting
`normalizerVersion: 4` is rejected. In `territory-import.test.ts`, change the current version to
`5` and assert version `4` requires a refresh:

```ts
assert.equal(needsTerritoryImport({ ...current, normalizerVersion: 4 }, draft), true);
assert.equal(needsTerritoryImport({ ...current, normalizerVersion: 5 }, draft), false);
```

Run:

```powershell
corepack pnpm --dir web test
```

Expected: FAIL because the TypeScript contract is still version 4 and has no addresses.

- [x] **Step 4: Parse only the approved address contract**

Add `ImportedSegmentAddress`, require exact address keys, validate geographic positions and nullable
strings, copy address arrays into parsed segments, and change the imported input literal version
to `5`. Change `needsTerritoryImport` to require version 5. Do not change the pinned Overture
release.

Run `corepack pnpm --dir web test`; parser and refresh checks must pass before continuing.

- [x] **Step 5: Write failing migration and database round-trip tests**

Add `segment_addresses` to the expected tables. Update the imported segment helper so every
synthetic import includes `addresses: []`, then add one segment with:

```js
addresses: [
  {
    number: '39483',
    street: 'Diego Drive',
    locality: 'Temecula',
    postcode: '92591',
    position: [-117.11037, 33.53768],
  },
  {
    number: null,
    street: 'Diego Drive',
    locality: null,
    postcode: null,
    position: [-117.11038, 33.53769],
  },
]
```

After `saveTerritoryDraft`, query the table and assert both rows reference the new current physical
segment ID and preserve nullable fields. Reimport the same logical segment and assert its new
physical version owns the new address rows. Add a manually activated road, remove it from the next
provider response, and assert its copied current segment retains its prior address evidence.

Run `corepack pnpm --dir web test`; expected: FAIL because the migration and inserts do not exist.

- [x] **Step 6: Persist addresses with their physical segment versions**

Create migration 013. In the import transaction:

1. Read address rows for current manual segments before retiring them.
2. Insert each imported physical segment and its imported address rows.
3. When preserving a missing manually activated segment, copy its previous address rows to the new
   physical segment version.
4. Keep historical address rows attached to historical segment versions.

Prepare one `INSERT INTO segment_addresses` statement and use the physical ID already constructed
as `` `${segment.id}@${generation}` ``. Do not add an address repository class or a second
transaction.

Run:

```powershell
python -m unittest discover -s web/importer -p "test_*.py"
corepack pnpm --dir web test
corepack pnpm --dir web lint
corepack pnpm --dir web typecheck
git diff --check
```

Expected: all pass.

- [ ] **Step 7: Commit the address evidence**

```powershell
git add IMPLEMENTATION_PLAN.md web/db/migrations/013_segment_addresses.sql web/importer/overture_import.py web/importer/test_overture_import.py web/lib/overture-import.ts web/lib/overture-import.test.ts web/lib/territory-import.ts web/lib/territory-import.test.ts web/lib/database.ts web/db/database.test.mjs
git commit -m "feat: retain packet starting addresses"
```

### Task 2: Implement the deterministic pure selector

**Files:**
- Create: `web/lib/packet-selection.ts`
- Create: `web/lib/packet-selection.test.ts`
- Modify: `web/package.json`

**Interfaces:**

- Consumes: `CoverageClass`, `LineString`, `Position`, and current heatmap classifications supplied
  by the database boundary.
- Produces:

```ts
export type PacketAddress = {
  number: string | null;
  street: string;
  locality: string | null;
  postcode: string | null;
  position: Position;
};

export type PacketSelectionSegment = {
  id: string;
  streetName: string;
  geometry: LineString;
  estimatedHomes: number;
  eligible: boolean;
  reserved: boolean;
  coverageClass: CoverageClass;
  addresses: PacketAddress[];
};

export type PacketSizeRequest = {
  quantity: number;
  targetHomes: number;
};

export type PacketProposal = {
  targetHomes: number;
  estimatedHomes: number;
  coverageClass: CoverageClass;
  segments: Array<{
    id: string;
    geometry: LineString;
    estimatedHomes: number;
  }>;
  start: { address: string; position: Position };
  streetNames: string[];
};

export type PacketGenerationResult = {
  proposals: PacketProposal[];
  warnings: string[];
};

export function parsePacketSizeRequests(value: unknown): PacketSizeRequest[];

export function generatePacketProposals(input: {
  center: Position;
  requests: PacketSizeRequest[];
  segments: PacketSelectionSegment[];
}): PacketGenerationResult;
```

- [ ] **Step 1: Write failing request-boundary and synthetic-graph tests**

Add exact-key parser tests accepting:

```ts
[
  { quantity: 2, targetHomes: 15 },
  { quantity: 1, targetHomes: 30 },
]
```

Reject an empty array, non-array, unknown keys, zero/negative/fractional values, strings, and unsafe
integers.

Build a literal graph with:

- two connected red segments near the church;
- one isolated red cul-de-sac farther away;
- one orange pair;
- one green neighbor attached to the isolated red segment;
- one excluded segment;
- one reserved segment; and
- usable addresses on terminal and internal segments.

Assert:

```ts
assert.deepEqual(
  result.proposals.map((proposal) => proposal.coverageClass),
  ['red', 'red', 'orange'],
);
assert.equal(new Set(result.proposals.flatMap((p) => p.segments.map((s) => s.id))).size,
  result.proposals.flatMap((p) => p.segments).length);
assert.ok(result.proposals.every((p) =>
  p.estimatedHomes === p.segments.reduce((sum, segment) => sum + segment.estimatedHomes, 0),
));
```

Assert the nearer red area is proposed before the farther red area, the isolated red packet does
not absorb its connected green neighbor, requested size 15 is matched to the small cul-de-sac,
excluded/reserved IDs never appear, and two calls return `deepEqual` results.

Run:

```powershell
node --experimental-strip-types --test web/lib/packet-selection.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 2: Implement validation and deterministic geometry primitives**

Use exact object-key checks. Expand quantities into stable target slots while preserving request-row
order.

Inside `packet-selection.ts`, implement only these private primitives:

```ts
const coverageOrder: CoverageClass[] = ['red', 'orange', 'yellow', 'green'];

function endpointKey([longitude, latitude]: Position): string {
  return `${longitude.toFixed(7)},${latitude.toFixed(7)}`;
}

function usableAddress(address: PacketAddress): boolean {
  return address.number !== null && address.number.trim() !== '' && address.street.trim() !== '';
}
```

Add local point-to-line distance using longitude scaled by `Math.cos(latitude)`; do not add a
geospatial dependency. Use endpoint keys only for adjacency. Preserve original geometry arrays in
proposal output.

- [ ] **Step 3: Implement connected outward growth and mixed-size matching**

For one anchor and heatmap range:

1. Start with the anchor.
2. Maintain unused same-range segments indexed by their two endpoint keys.
3. Add only a segment touching the selected set.
4. Rank frontier additions by distance from church, then smallest increase in selected bounding-box
   area, then segment ID.
5. Record every connected prefix that contains a usable starting address.
6. For each remaining target slot, select the prefix minimizing
   `Math.abs(estimatedHomes - targetHomes) / targetHomes`.
7. Prefer a prefix inside the 20-percent range, then the smaller geographic footprint, then fewer
   segments, then stable target-slot order.

Choose the anchor by heatmap order, then distance to church, then segment ID. After accepting a
proposal, remove its segments and target slot and restart from the nearest remaining anchor.
Continue into newer ranges only when older ones have no selectable segments.

If a connected component has no usable address, remove that component from this generation and add:

```text
Skipped a connected area because no usable starting address was available.
```

If request slots remain after all selectable segments are exhausted, add:

```text
Generated fewer packets because no more eligible streets were available.
```

Return only the selected starting address, never every address.

- [ ] **Step 4: Implement terminal-address ranking and fallbacks**

For a candidate prefix, count selected endpoint occurrences. A terminal endpoint occurs once.
Terminal segment addresses rank by:

1. north of their nearest road-centerline point;
2. distance to that segment's outer terminal endpoint; and
3. formatted address plus coordinates.

If no terminal has a usable address, rank usable addresses on all selected segments by distance to
the nearest terminal endpoint, then formatted address and coordinates. For a closed loop with no
terminal, use distance to the church as the first key.

Format without empty punctuation:

```ts
function formatAddress(address: PacketAddress): string {
  const locality = [address.locality, address.postcode].filter(Boolean).join(' ');
  return `${address.number} ${address.street}${locality ? `, ${locality}` : ''}`;
}
```

Deduplicate and sort `streetNames` with JavaScript's default UTF-16 code-unit `sort()` so results
do not depend on the host locale. Do not output internal sequence numbers.

- [ ] **Step 5: Add tolerance, exception, and saved-real-geometry checks**

Add focused tests proving:

- a normal 30-home request selects a total from 24 through 36;
- a 7-home isolated cul-de-sac remains under target instead of adding a green neighbor;
- one 50-home segment may satisfy a 30-home request without splitting;
- zero-estimate connected roads terminate and never duplicate;
- terminal north-side/outer-end ranking wins;
- missing terminal numbers fall back inside the packet;
- a component with no usable number is skipped with the exact warning; and
- every proposed segment set is connected by endpoint keys.

Load `web/db/fixtures/temecula-segments.json` as the saved real geometry fixture, attach deterministic
red classifications and test addresses to its named segments, request mixed sizes, and assert the
result is connected, outward-ordered, nonduplicating, and identical on repetition.

Add `lib/packet-selection.test.ts` to the explicit `web/package.json` test command. Run:

```powershell
corepack pnpm --dir web test
corepack pnpm --dir web lint
corepack pnpm --dir web typecheck
git diff --check
```

Expected: all pass.

- [ ] **Step 6: Commit the selector**

```powershell
git add web/lib/packet-selection.ts web/lib/packet-selection.test.ts web/package.json
git commit -m "feat: generate deterministic packet proposals"
```

### Task 3: Build the read-only database and HTTP boundary

**Files:**
- Create: `web/app/api/packet-proposals/route.ts`
- Create: `web/app/api/packet-proposals/route.test.ts`
- Modify: `web/lib/database.ts`
- Modify: `web/db/database.test.mjs`
- Modify: `web/package.json`

**Interfaces:**

- Consumes: `getCoverageWorkspace`, current `street_segments`, `segment_addresses`, active
  `packet_segments`, `parsePacketSizeRequests`, and `generatePacketProposals`.
- Produces:

```ts
export type PacketGenerationWorkspace = {
  center: Position;
  segments: PacketSelectionSegment[];
};

export function getPacketGenerationWorkspace(
  filename?: string,
  asOf?: string,
): PacketGenerationWorkspace;
```

```text
POST /api/packet-proposals
{ "requests": [{ "quantity": 2, "targetHomes": 15 }] }

200
{ "proposals": PacketProposal[], "warnings": string[] }
```

- [ ] **Step 1: Write failing database-workspace tests**

Import one address-backed segment, one excluded segment, and one hidden segment. Insert an active
packet reservation referencing a retired physical version of a logical segment. Assert the packet
workspace:

- exposes current coverage classes and eligibility;
- loads address points only for current physical segments;
- marks the logically matching current segment `reserved: true`;
- marks no segment reserved for a completed or cancelled packet; and
- never returns resident names, units, coverage histories, or all-address data through a proposal.

Use the existing temporary migrated database helper. Run `corepack pnpm --dir web test`; expected:
FAIL because `getPacketGenerationWorkspace` does not exist.

- [ ] **Step 2: Implement the smallest database read model**

Call `getCoverageWorkspace(filename, asOf)` to reuse the effective-date and heatmap rules. In one
additional database connection:

- query usable and numberless address rows joined to current physical segments;
- query distinct reserved logical `import_segment_id` values through active packets; and
- map those two lookups onto the existing coverage segment list.

Do not add a new table, cache, repository, adjacency table, or stored proposal.

Run the database test and full web test suite; expected: PASS.

- [ ] **Step 3: Write failing real-route tests with mutation counts**

Create an exact request helper and call the route against a temporary migrated database. Before the
request, use `saveTerritoryDraft` with a two-segment connected imported graph whose first and last
segments each have a usable address. Record one old completion date on both segments so the result
has a known heatmap range. Before and after the valid request, count rows in:

```ts
['batches', 'packets', 'packet_segments', 'coverage_events']
```

Assert counts are unchanged and repeated responses have identical serialized JSON. Reject:

```ts
[
  {},
  { requests: [] },
  { requests: [{ quantity: 0, targetHomes: 30 }] },
  { requests: [{ quantity: 1, targetHomes: 30 }], extra: true },
  { requests: [{ quantity: 1, targetHomes: 30, extra: true }] },
]
```

with status 400 and no mutation.

- [ ] **Step 4: Implement the proposal endpoint**

Parse JSON, require the body to have exactly the `requests` key, validate requests with the pure
parser, load the packet workspace, and return `generatePacketProposals`. Return:

```ts
Response.json({ error: 'Invalid packet request' }, { status: 400 })
```

for malformed bodies and:

```ts
Response.json({ error: 'Could not generate packet proposals' }, { status: 500 })
```

for unexpected database failures. Do not expose SQLite messages.

Add the route test to the package test command. Run:

```powershell
corepack pnpm --dir web test
corepack pnpm --dir web lint
corepack pnpm --dir web typecheck
git diff --check
```

Expected: all pass.

- [ ] **Step 5: Commit the read-only boundary**

```powershell
git add web/app/api/packet-proposals/route.ts web/app/api/packet-proposals/route.test.ts web/lib/database.ts web/db/database.test.mjs web/package.json
git commit -m "feat: expose packet proposal previews"
```

### Task 4: Add the map-dominant packet proposal page

**Files:**
- Create: `web/app/packets/page.tsx`
- Create: `web/components/PacketGenerator.tsx`
- Create: `web/components/PacketProposalMap.tsx`
- Create: `web/components/PacketGenerator.test.mjs`
- Modify: `web/components/CoverageDashboard.tsx`
- Modify: `web/app/globals.css`
- Modify: `web/package.json`

**Interfaces:**

- Consumes: the proposal API, `PacketGenerationResult`, existing Google Maps loader, `latLng`, and
  zoom-sensitive `segmentStrokeWeight`.
- Produces: an accessible `/packets` page with mixed request rows, read-only proposal cards, one
  focused interactive map, and a standard unlabeled Google starting pin.

- [ ] **Step 1: Write the failing page-contract test**

Read the component sources and assert they contain:

```js
assert.match(generator, /Generate proposals/);
assert.match(generator, /Add packet size/);
assert.match(generator, /Starting address/);
assert.match(generator, /\/api\/packet-proposals/);
assert.doesNotMatch(generator, /Finalize|QR code|walking route|end point/i);
assert.match(coverage, /href="\/packets"/);
```

Add `components/PacketGenerator.test.mjs` to the package test command. Run the single test; expected:
FAIL because the files and link do not exist.

- [ ] **Step 2: Create the server page and native request form**

`web/app/packets/page.tsx` loads only the Google browser key and renders `PacketGenerator`; proposal
data remains request-driven.

Initialize one row with quantity `1` and target `30`. Each row has labeled native number inputs with
`min="1"` and `step="1"`, plus a remove button when more than one row exists. **Add packet size**
appends `{ quantity: '1', targetHomes: '30' }`.

On submit:

1. convert both fields with `Number`;
2. reject non-positive/non-integer values client-side;
3. POST exact `{ requests }`;
4. select the first returned proposal; and
5. announce success, warning, or failure through one `aria-live="polite"` region.

Keep the form editable after generation. Submitting unchanged values replaces state with the
identical response. Do not persist form rows.

- [ ] **Step 3: Render read-only proposal review cards**

Each button card shows:

```text
Packet 1
Target 30 tracts
28 estimated tracts
```

The selected card additionally shows the written starting address and deduplicated street summary.
Cards cannot drag, reorder, remove segments, or regenerate individually. If the API returns fewer
packets, render its warning under the list.

Use church-specific terms `tracts` and `outreach`. Add **Back to coverage** in the header and change
the Coverage header to include **Generate packets** plus **Territory setup**.

- [ ] **Step 4: Render one selected packet on Google Maps**

Reuse `loadGoogleMaps`, `latLng`, and `segmentStrokeWeight`. Create the map once with the same
controls disabled as the coverage map. For the selected proposal:

- draw every selected geometry with `#D66B2D`, opacity `0.72`, rounded Google polyline defaults,
  and zoom-sensitive weight;
- create one unlabeled default `AdvancedMarkerElement` at `proposal.start.position`;
- fit bounds around every selected coordinate and the marker with 48 pixels of padding; and
- remove old polylines, listeners, and marker before drawing the next selected proposal.

The map has `aria-label="Selected packet proposal"` and remains the majority column. Do not render
the heatmap legend, internal IDs, individual home markers, QR code, or route instructions.

- [ ] **Step 5: Add only page-specific layout styles**

Reuse `.territory-page`, `.territory-header`, `.territory-workspace`, `.map-panel`,
`.territory-sidebar`, `.sidebar-scroll`, and existing form/button styles. Add narrowly named
`.packet-*` rules for request rows, cards, selected state, address, and street summary. Preserve the
355-pixel sidebar and full-height map on desktop; use the repository's existing responsive
breakpoint behavior instead of adding a design system.

Run:

```powershell
corepack pnpm --dir web test
corepack pnpm --dir web lint
corepack pnpm --dir web typecheck
corepack pnpm --dir web build
git diff --check
```

Expected: all pass, and the build lists `/packets` plus `/api/packet-proposals`.

- [ ] **Step 6: Commit the proposal page**

```powershell
git add web/app/packets/page.tsx web/components/PacketGenerator.tsx web/components/PacketProposalMap.tsx web/components/PacketGenerator.test.mjs web/components/CoverageDashboard.tsx web/app/globals.css web/package.json
git commit -m "feat: add packet proposal review page"
```

### Task 5: Refresh real data, verify Phase 4, and stop for founder review

**Files:**
- Modify: `README.md`
- Modify: `IMPLEMENTATION_PLAN.md`

**Interfaces:**

- Consumes: completed Tasks 1-4, the canonical Temecula territory, existing Google API
  configuration, and the approved Phase 4 browser checkpoint.
- Produces: normalizer-version-5 pilot data, recorded automated/browser evidence, and Phase 4
  status `Awaiting human review`.

- [ ] **Step 1: Run the complete automated gate before external data**

From the repository root:

```powershell
python -m unittest discover -s web/importer -p "test_*.py"
corepack pnpm --dir web test
corepack pnpm --dir web lint
corepack pnpm --dir web typecheck
corepack pnpm --dir web build
git diff --check
```

Expected: every command passes. Query the canonical database and record the pre-refresh import
generation and normalizer version.

- [ ] **Step 2: Reimport the canonical pilot once**

Start the real app with its configured environment. Open Territory Setup and save the unchanged
address, radius, square/circle selection, exclusions, activations, and exact segment exclusions.
Because the saved normalizer is version 4 and the code requires version 5, this exact save must run
one Overture refresh.

After completion, verify with read-only SQL:

```sql
SELECT import_normalizer_version, import_generation
FROM territories
WHERE id = 'territory-temecula-pilot';

SELECT COUNT(*) AS usable
FROM segment_addresses
WHERE house_number IS NOT NULL AND length(trim(house_number)) > 0;
```

Expected: normalizer version `5`, generation increased exactly once, and usable address count is
greater than zero. Confirm the saved boundary, enabled/disabled polygons, manual activations, exact
segment exclusions, coverage history, and active packet references remain intact.

- [ ] **Step 3: Perform the real-browser acceptance check**

Open `/` and confirm **Generate packets** navigates to `/packets`. On `/packets`:

1. request at least two packet sizes;
2. generate proposals;
3. record the returned JSON;
4. inspect every card, connected highlight, readable road label, default starting pin, written
   address, estimate, and admin-only street summary;
5. confirm packets may focus different neighborhoods while each selected packet is connected;
6. confirm early all-red proposals expand outward from the church;
7. submit the unchanged request again; and
8. compare the second JSON byte-for-byte with the first.

Query `batches`, `packets`, `packet_segments`, and `coverage_events` before and after. Their row
counts must not change. Check browser console and server output for errors.

- [ ] **Step 4: Record operation and evidence**

Add a short README section describing:

```text
Coverage → Generate packets → enter quantity/target rows → Generate proposals → select each card.
Proposals are read-only and unreserved until Phase 5.
```

In `IMPLEMENTATION_PLAN.md`, set Phase 4 to `Awaiting human review` and record:

- commit hashes for Tasks 1-4;
- Python and Node test totals;
- lint, typecheck, and production-build results;
- canonical import generation/version and usable address count;
- mixed request used in browser acceptance;
- deterministic response comparison;
- no-mutation row counts; and
- the exact remaining founder review: grouping, tract counts, highlighted segments, outward
  progression, and starting points.

- [ ] **Step 5: Request focused code review and resolve findings**

Review the full Phase 4 diff against `PRODUCT.md`, the approved design, and this plan. Every
important finding must receive one focused regression before correction. Re-run the complete
automated gate and the affected browser step after corrections.

- [ ] **Step 6: Commit evidence and stop**

```powershell
git add README.md IMPLEMENTATION_PLAN.md
git commit -m "docs: record phase 4 review evidence"
```

Do not mark Phase 4 complete, finalize a batch, generate a PDF, or begin Phase 5. Leave the working
app available for the founder's human-review checkpoint.
