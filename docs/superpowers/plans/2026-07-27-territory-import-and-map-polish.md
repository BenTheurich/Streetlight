# Streetlight Phase 2 Territory Import and Map Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Phase 2 proof fixture with a genuine, automatic, residential-focused
Overture street import and finish the approved Territory Setup map interactions.

**Architecture:** Keep the existing Next.js, SQLite, and native Google Maps application.
`Save changes` decides whether the saved import footprint still covers the draft; when it does
not, one synchronous server request runs a small Python/DuckDB importer and atomically replaces
the saved territory, exclusions, segments, and import metadata. Overture remains the durable
street/address source, while Google remains the display and geocoding provider.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, Node 22 built-in SQLite,
Python 3, DuckDB 1.5.5 with `spatial` and `httpfs`, native Google Maps JavaScript API, Overture
Maps release `2026-06-17.0`, Node's and Python's built-in test runners, Biome.

## Global Constraints

- Read `PRODUCT.md` and `IMPLEMENTATION_PLAN.md` before executing any task.
- Implement only the approved Phase 2 amendment; stop at its human-review checkpoint.
- Keep Streetlight deterministic and AI-free.
- Use Overture release `2026-06-17.0`; do not silently float to a newer release.
- Import only a bounding box enclosing the requested circle, while retaining complete source
  lines that touch that box.
- Always retain named `residential` and `living_street` roads.
- Retain named `primary`, `secondary`, `tertiary`, and `unclassified` roads only when at least
  one matching address is assigned within 40 meters.
- Exclude motorway, trunk, service, path, footway, cycleway, track, pedestrian, steps, and
  bridleway classes.
- Assign an address only to the nearest normalized segment with the same canonical street name
  and a distance of at most 40 meters.
- Do not store raw address points in Phase 2; use them transiently to calculate home estimates.
- Do not add a background queue, percentage progress, resumable jobs, provider abstraction,
  generalized GIS framework, geometry correction UI, or home-count correction UI.
- The current 55-segment fixture is proof-only. The first successful save replaces it.
- A failed import or database write must preserve the previously saved workspace and the
  browser's unsaved draft.
- Exclusion-only saves and radius reductions within the imported footprint must not re-import.
- Existing exclusion polygons remain at their geographic coordinates when the center changes.
- Use the Google map's native vertex handles and cursors; do not create custom marker overlays.
- Automated checks and production builds must work without Google or Overture network access.

---

## File Structure

- `web/db/migrations/003_territory_import.sql`: import footprint metadata and road class.
- `web/db/seed.mjs`: seed proof data only until a real import exists.
- `web/db/database.test.mjs`: migration, seed, replacement, and rollback evidence.
- `web/importer/overture_import.py`: pinned Overture download, normalization, and JSON CLI.
- `web/importer/test_overture_import.py`: deterministic normalization and road-filter tests.
- `web/importer/requirements.txt`: the already-proven DuckDB runtime dependency.
- `web/lib/territory-import.ts`: pure decision for whether a draft needs an import.
- `web/lib/territory-import.test.ts`: import-footprint decision checks.
- `web/lib/overture-import.ts`: Node-to-Python process boundary and output validation.
- `web/lib/overture-import.test.ts`: argument and trust-boundary parsing checks.
- `web/lib/database.ts`: import metadata read model and atomic segment replacement.
- `web/app/api/territory/route.ts`: conditional import inside the existing PATCH request.
- `web/lib/territory-map-style.ts`: zoom-scaled line styles.
- `web/lib/territory-map-style.test.ts`: line-weight regression checks.
- `web/components/TerritoryMap.tsx`: first-point editing, cursors, opacity, and zoom styling.
- `web/components/TerritoryEditor.tsx`: proof-refresh state and import-in-progress UI.
- `web/app/globals.css`: solid legend and blocking import notice.
- `README.md`: local importer setup.
- `ENVIRONMENTS.md`: optional Python executable configuration.
- `docs/superpowers/specs/2026-07-27-territory-setup-design.md`: implementation evidence.
- `IMPLEMENTATION_PLAN.md`: Phase 2 checkpoint status and evidence.

### Task 1: Persist the import footprint and retire seeded demo history

**Files:**
- Create: `web/db/migrations/003_territory_import.sql`
- Modify: `web/db/seed.mjs`
- Modify: `web/db/database.test.mjs`
- Modify: `web/lib/database.ts`
- Create: `web/lib/territory-import.ts`
- Create: `web/lib/territory-import.test.ts`
- Modify: `web/package.json`

**Interfaces:**
- Produces: `TerritoryImportMetadata`.
- Produces: `needsTerritoryImport(metadata, draft): boolean`.
- Stores: import kind, release, center, radius, and completion time.

- [ ] **Step 1: Write failing import-state and seed tests**

Add a focused TypeScript test:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { needsTerritoryImport } from './territory-import.ts';

const draft = {
  originAddress: '31087 Nicolas Rd, Temecula, CA 92591',
  center: [-117.1274, 33.5107] as [number, number],
  radiusMiles: 1,
  exclusions: [],
};

test('proof data and an expanded footprint require imports', () => {
  assert.equal(
    needsTerritoryImport(
      { kind: 'proof', release: null, center: null, radiusMiles: null, completedAt: null },
      draft,
    ),
    true,
  );
  assert.equal(
    needsTerritoryImport(
      {
        kind: 'overture',
        release: '2026-06-17.0',
        center: draft.center,
        radiusMiles: 0.5,
        completedAt: '2026-07-27T12:00:00.000Z',
      },
      draft,
    ),
    true,
  );
});

test('exclusion changes and radius reductions reuse a current footprint', () => {
  assert.equal(
    needsTerritoryImport(
      {
        kind: 'overture',
        release: '2026-06-17.0',
        center: draft.center,
        radiusMiles: 2,
        completedAt: '2026-07-27T12:00:00.000Z',
      },
      {
        ...draft,
        exclusions: [{
          id: 'x',
          name: '',
          geometry: {
            type: 'Polygon',
            coordinates: [[[-117.13, 33.51], [-117.12, 33.51], [-117.13, 33.51]]],
          },
        }],
      },
    ),
    false,
  );
});
```

Update the database test to assert:

```js
assert.equal(workspace.import.kind, 'proof');
assert.equal(workspace.import.release, null);
assert.equal(summary.packetCount, 0);
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```powershell
pnpm --dir web exec node --experimental-strip-types --test lib/territory-import.test.ts
pnpm --dir web exec node --test db/database.test.mjs
```

Expected: FAIL because import metadata, its decision helper, and the revised seed behavior do
not exist.

- [ ] **Step 3: Add the minimum schema and decision helper**

Create migration `003_territory_import.sql`:

```sql
ALTER TABLE territories
  ADD COLUMN import_kind TEXT NOT NULL DEFAULT 'proof'
  CHECK (import_kind IN ('proof', 'overture'));
ALTER TABLE territories ADD COLUMN import_release TEXT;
ALTER TABLE territories ADD COLUMN import_center_latitude REAL;
ALTER TABLE territories ADD COLUMN import_center_longitude REAL;
ALTER TABLE territories ADD COLUMN import_radius_meters REAL;
ALTER TABLE territories ADD COLUMN import_completed_at TEXT;
ALTER TABLE street_segments
  ADD COLUMN road_class TEXT NOT NULL DEFAULT 'residential';

DELETE FROM packet_segments WHERE packet_id = 'packet-foundation-001';
DELETE FROM coverage_events WHERE id = 'coverage-foundation-001';
DELETE FROM packets WHERE id = 'packet-foundation-001';
DELETE FROM batches WHERE id = 'batch-foundation-001';
```

Remove those four sample-history inserts and the now-unused `sampleSegment` variable from
`web/db/seed.mjs`. Guard only the proof segment insertion:

```js
const territory = database
  .prepare('SELECT import_kind FROM territories WHERE id = ?')
  .get('territory-temecula-pilot');
if (territory?.import_kind === 'proof') {
  for (const segment of fixture.segments) {
    insertSegment.run(
      segment.id,
      churchId,
      territoryId,
      segment.source_segment_id,
      segment.street_name,
      JSON.stringify(segment.geometry),
      segment.estimated_homes,
    );
  }
}
```

Extend the existing territory SELECT and `TerritoryWorkspace` read model with
`TerritoryImportMetadata`. Convert stored meters back to miles and return `null` center/radius
for proof data.

Create the pure decision helper:

```ts
import type { TerritoryDraftInput } from './territory-draft.ts';
import type { Position } from './territory-geometry.ts';

export const OVERTURE_RELEASE = '2026-06-17.0';

export type TerritoryImportMetadata = {
  kind: 'proof' | 'overture';
  release: string | null;
  center: Position | null;
  radiusMiles: number | null;
  completedAt: string | null;
};

export function needsTerritoryImport(
  imported: TerritoryImportMetadata,
  draft: TerritoryDraftInput,
): boolean {
  return (
    imported.kind === 'proof' ||
    imported.release !== OVERTURE_RELEASE ||
    imported.center === null ||
    imported.radiusMiles === null ||
    imported.center[0] !== draft.center[0] ||
    imported.center[1] !== draft.center[1] ||
    draft.radiusMiles > imported.radiusMiles + 1e-9
  );
}
```

Add `lib/territory-import.test.ts` to the existing `web/package.json` test command.

- [ ] **Step 4: Run the focused and canonical tests**

Run:

```powershell
pnpm --dir web test
```

Expected: PASS, including zero seeded packets and a proof import state.

- [ ] **Step 5: Commit the import-state slice**

```powershell
git add web/db/migrations/003_territory_import.sql web/db/seed.mjs web/db/database.test.mjs web/lib/database.ts web/lib/territory-import.ts web/lib/territory-import.test.ts web/package.json
git commit -m "feat: track territory import footprints"
```

### Task 2: Normalize residential-focused Overture roads deterministically

**Files:**
- Create: `web/importer/__init__.py`
- Create: `web/importer/overture_import.py`
- Create: `web/importer/test_overture_import.py`
- Create: `web/importer/requirements.txt`
- Modify: `package.json`

**Interfaces:**
- Produces: canonical street-name matching.
- Produces: normalized segments split at intersections and turns of at least 85 degrees.
- Produces: nearest same-street address assignment within 40 meters.
- Produces: the founder-approved class filter.

- [ ] **Step 1: Write failing pure Python normalization tests**

Use small in-memory GeoJSON-like dictionaries, not a network fixture:

```py
from unittest import TestCase
from overture_import import canonical_street_name, normalize_features


class NormalizeFeaturesTest(TestCase):
    def test_canonical_names_ignore_case_punctuation_and_suffix_spelling(self):
        self.assertEqual(canonical_street_name("Jons Place"), "jons pl")
        self.assertEqual(canonical_street_name("JONS PL."), "jons pl")

    def test_keeps_residential_without_addresses_and_tertiary_only_with_an_address(self):
        roads = [
            road("r1", "residential", "Quiet Lane", [[0, 0], [0.001, 0]]),
            road("r2", "tertiary", "Calle Medusa", [[0, 0.001], [0.001, 0.001]]),
            road("r3", "tertiary", "Empty Avenue", [[0, 0.002], [0.001, 0.002]]),
            road("r4", "service", "Loading Road", [[0, 0.003], [0.001, 0.003]]),
        ]
        addresses = [address("Calle Medusa", 0.0005, 0.00105)]

        result = normalize_features(roads, addresses)

        self.assertEqual([item["streetName"] for item in result], ["Calle Medusa", "Quiet Lane"])
        self.assertEqual(result[0]["estimatedHomes"], 1)
```

The test module may define only the two tiny `road()` and `address()` dictionary builders
needed by the examples.

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
python -m unittest web.importer.test_overture_import
```

Expected: FAIL because the importer module does not exist.

- [ ] **Step 3: Implement the smallest correct normalizer**

In `overture_import.py`, keep download imports out of module scope so pure tests do not require
DuckDB:

```py
ALWAYS_KEEP = {"residential", "living_street"}
KEEP_WITH_ADDRESS = {"primary", "secondary", "tertiary", "unclassified"}
MAX_ADDRESS_DISTANCE_METERS = 40
TURN_SPLIT_DEGREES = 85


def canonical_street_name(value: str) -> str:
    words = re.sub(r"[^a-z0-9 ]", " ", value.lower()).split()
    suffixes = {
        "avenue": "ave", "drive": "dr", "lane": "ln", "place": "pl",
        "road": "rd", "street": "st", "circle": "cir", "court": "ct",
        "parkway": "pkwy",
    }
    return " ".join(suffixes.get(word, word) for word in words)


def keep_segment(road_class: str, address_count: int) -> bool:
    return road_class in ALWAYS_KEEP or (
        road_class in KEEP_WITH_ADDRESS and address_count > 0
    )
```

Implement these private helpers in the same file:

- extract one display name from the Overture names object;
- flatten `LineString` and `MultiLineString` geometries;
- split lines at shared endpoints/intersections and direction changes of at least 85 degrees;
- project short point-to-segment distances locally in meters;
- assign each address once to the nearest segment whose canonical name matches within 40 meters;
- sort output by canonical name, source ID, and part index;
- produce IDs as `overture:{source_id}:{part_index}`.

Return only:

```py
{
    "id": segment_id,
    "sourceSegmentId": source_id,
    "roadClass": road_class,
    "streetName": street_name,
    "geometry": {"type": "LineString", "coordinates": coordinates},
    "estimatedHomes": address_count,
}
```

Set `web/importer/requirements.txt` to:

```text
duckdb==1.5.5
```

Append the Python unit test to the root test command:

```json
"test": "pnpm --dir web test && python -m unittest web.importer.test_overture_import"
```

- [ ] **Step 4: Run the pure tests**

Run:

```powershell
python -m unittest web.importer.test_overture_import
pnpm test
```

Expected: PASS without network access.

- [ ] **Step 5: Commit the normalizer**

```powershell
git add web/importer package.json
git commit -m "feat: normalize overture territory roads"
```

### Task 3: Add the pinned live downloader and validate its process boundary

**Files:**
- Modify: `web/importer/overture_import.py`
- Create: `web/lib/overture-import.ts`
- Create: `web/lib/overture-import.test.ts`
- Modify: `web/package.json`

**Interfaces:**
- Python CLI input: `--longitude`, `--latitude`, and `--radius-miles`.
- Python CLI stdout: one JSON `ImportedTerritoryInput`; diagnostics go to stderr.
- Node process: `runOvertureImport(center, radiusMiles): Promise<ImportedTerritoryInput>`.

- [ ] **Step 1: Write failing Node trust-boundary tests**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildImporterArguments, parseOvertureImportOutput } from './overture-import.ts';

test('builds stable importer arguments', () => {
  assert.deepEqual(buildImporterArguments([-117.1274, 33.5107], 1), [
    '--longitude', '-117.1274',
    '--latitude', '33.5107',
    '--radius-miles', '1',
  ]);
});

test('rejects malformed importer output', () => {
  assert.throws(
    () => parseOvertureImportOutput('{"release":"wrong","segments":[]}'),
    /import output/,
  );
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
pnpm --dir web exec node --experimental-strip-types --test lib/overture-import.test.ts
```

Expected: FAIL because the process-boundary module does not exist.

- [ ] **Step 3: Implement the bbox query and JSON CLI**

Compute the circle-enclosing box with latitude-dependent longitude width. Lazily import DuckDB:

```py
def download_features(longitude: float, latitude: float, radius_miles: float):
    import duckdb

    west, south, east, north = enclosing_bbox(longitude, latitude, radius_miles)
    connection = duckdb.connect()
    connection.execute("INSTALL spatial; LOAD spatial; INSTALL httpfs; LOAD httpfs")
    connection.execute("SET s3_region='us-west-2'")
    connection.execute("SET s3_access_key_id=''")
    connection.execute("SET s3_secret_access_key=''")
    connection.execute("SET s3_session_token=''")
    release = "2026-06-17.0"
    segments = query_bbox(
        connection,
        f"s3://overturemaps-us-west-2/release/{release}/theme=transportation/type=segment/*",
        west, south, east, north,
    )
    addresses = query_bbox(
        connection,
        f"s3://overturemaps-us-west-2/release/{release}/theme=addresses/type=*/*",
        west, south, east, north,
    )
    return segments, addresses
```

The SQL must use Overture's bbox columns to restrict reads, return complete geometry for every
source feature touching the bbox, and select only fields used by the normalizer. The CLI prints:

```py
print(json.dumps({
    "release": "2026-06-17.0",
    "center": [args.longitude, args.latitude],
    "radiusMiles": args.radius_miles,
    "completedAt": datetime.now(timezone.utc).isoformat(),
    "segments": normalize_features(roads, addresses),
}, separators=(",", ":")))
```

Implement the Node boundary with `node:child_process.spawn` and no new package:

```ts
export async function runOvertureImport(
  center: Position,
  radiusMiles: number,
): Promise<ImportedTerritoryInput> {
  const executable = process.env.STREETLIGHT_PYTHON ?? 'python';
  const script = path.join(process.cwd(), 'importer', 'overture_import.py');
  const child = spawn(executable, [script, ...buildImporterArguments(center, radiusMiles)]);
  const stdout = await readProcess(child);
  return parseOvertureImportOutput(stdout);
}
```

`parseOvertureImportOutput` must validate the pinned release, finite coordinates, positive
radius, ISO timestamp, nonempty unique segment IDs, approved road classes, nonnegative integer
counts, nonempty names, and valid two-or-more-point `LineString` coordinates.

Add `lib/overture-import.test.ts` to the web test command.

- [ ] **Step 4: Run the process-boundary and canonical tests**

Run:

```powershell
pnpm --dir web test
python -m unittest web.importer.test_overture_import
```

Expected: PASS without making a live Overture request.

- [ ] **Step 5: Commit the live import boundary**

```powershell
git add web/importer/overture_import.py web/lib/overture-import.ts web/lib/overture-import.test.ts web/package.json
git commit -m "feat: download pinned overture territory data"
```

### Task 4: Import only when needed and replace segments atomically

**Files:**
- Modify: `web/lib/database.ts`
- Modify: `web/db/database.test.mjs`
- Modify: `web/app/api/territory/route.ts`

**Interfaces:**
- Adds: `TerritoryWorkspace.import: TerritoryImportMetadata`.
- Adds: `TerritorySegment.roadClass: string`.
- Changes: `saveTerritoryDraft(draft, options?): void`.
- `options.imported` atomically replaces segments and import metadata.

- [ ] **Step 1: Write failing database replacement and rollback tests**

Add two database tests:

```js
test('an imported save atomically replaces proof segments and records its footprint', () => {
  saveTerritoryDraft(draft, {
    filename,
    imported: importedTerritory([
      importedSegment('one', 'Residential Road', 'residential', 8),
      importedSegment('two', 'Calle Medusa', 'tertiary', 3),
    ]),
  });
  const saved = getTerritoryWorkspace(filename);
  assert.equal(saved.import.kind, 'overture');
  assert.equal(saved.import.release, '2026-06-17.0');
  assert.equal(saved.segments.length, 2);
  assert.equal(saved.segments.find((segment) => segment.id === 'one').roadClass, 'residential');
});

test('a replacement failure preserves the complete saved workspace', () => {
  const before = getTerritoryWorkspace(filename);
  assert.throws(() =>
    saveTerritoryDraft(changedDraft, {
      filename,
      imported: importedTerritory([
        importedSegment('duplicate', 'A Street', 'residential', 1),
        importedSegment('duplicate', 'B Street', 'residential', 1),
      ]),
    }),
  );
  assert.deepEqual(getTerritoryWorkspace(filename), before);
});
```

Use the returned segment order in assertions instead of relying on array indexes when the
existing query sorts differently.

- [ ] **Step 2: Run the database test and verify it fails**

Run:

```powershell
pnpm --dir web exec node --test db/database.test.mjs
```

Expected: FAIL because the read model and save function do not support imports.

- [ ] **Step 3: Extend the existing transaction instead of adding an import service**

Change the save signature:

```ts
type SaveTerritoryOptions = {
  filename?: string;
  imported?: ImportedTerritoryInput;
};

export function saveTerritoryDraft(
  draft: TerritoryDraftInput,
  options: SaveTerritoryOptions = {},
): void {
  const database = openWorkspaceDatabase(options.filename);
```

Within the existing `BEGIN IMMEDIATE` transaction, after the territory and exclusions update:

```ts
if (options.imported) {
  database
    .prepare('DELETE FROM street_segments WHERE territory_id = ? AND church_id = ?')
    .run(PILOT_TERRITORY_ID, PILOT_CHURCH_ID);

  for (const segment of options.imported.segments) {
    insertSegment.run(
      segment.id,
      PILOT_CHURCH_ID,
      PILOT_TERRITORY_ID,
      segment.sourceSegmentId,
      segment.roadClass,
      segment.streetName,
      JSON.stringify(segment.geometry),
      segment.estimatedHomes,
    );
  }

  updateImport.run(
    options.imported.release,
    options.imported.center[1],
    options.imported.center[0],
    options.imported.radiusMiles * 1609.344,
    options.imported.completedAt,
    PILOT_TERRITORY_ID,
    PILOT_CHURCH_ID,
  );
}
```

Read those fields back into `workspace.import`, and select `road_class` with every segment.

Update PATCH without a queue:

```ts
const workspace = getTerritoryWorkspace();
const imported = needsTerritoryImport(workspace.import, draft)
  ? await runOvertureImport(draft.center, draft.radiusMiles)
  : undefined;
saveTerritoryDraft(draft, { imported });
return Response.json(getTerritoryWorkspace());
```

Keep the current generic 500 response so Python stderr or local paths are not exposed to the
browser.

- [ ] **Step 4: Run database, route-adjacent, and canonical checks**

Run:

```powershell
pnpm --dir web test
pnpm --dir web typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit the atomic save**

```powershell
git add web/lib/database.ts web/db/database.test.mjs web/app/api/territory/route.ts
git commit -m "feat: replace territory segments atomically"
```

### Task 5: Make segment and exclusion drawing legible at every zoom

**Files:**
- Create: `web/lib/territory-map-style.ts`
- Create: `web/lib/territory-map-style.test.ts`
- Modify: `web/components/TerritoryMap.tsx`
- Modify: `web/app/globals.css`
- Modify: `web/package.json`

**Interfaces:**
- Produces: `segmentStrokeWeight(zoom): number`.
- Uses: 2px at broad views, scaling to 5px at close views.
- Uses: solid, semi-transparent orange and gray segment lines.

- [ ] **Step 1: Write the failing zoom-style test**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { segmentStrokeWeight } from './territory-map-style.ts';

test('segment strokes scale from two to five pixels', () => {
  assert.equal(segmentStrokeWeight(10), 2);
  assert.equal(segmentStrokeWeight(12), 2);
  assert.equal(segmentStrokeWeight(13), 3);
  assert.equal(segmentStrokeWeight(14), 4);
  assert.equal(segmentStrokeWeight(17), 5);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
pnpm --dir web exec node --experimental-strip-types --test lib/territory-map-style.test.ts
```

Expected: FAIL because the style helper does not exist.

- [ ] **Step 3: Add the style helper and use one native editable path**

```ts
export function segmentStrokeWeight(zoom: number): number {
  return Math.min(5, Math.max(2, zoom - 10));
}
```

In `TerritoryMap.tsx`:

- remove excluded-line dash icons;
- use orange opacity `0.65` and gray opacity `0.5`;
- listen to `zoom_changed` and update existing segment polyline `strokeWeight`;
- when drawing starts, set `draggableCursor: 'crosshair'`;
- reset the draggable cursor when drawing ends or is cancelled;
- create the native editable partial polyline after the first click, so its first native vertex
  handle is immediately visible;
- listen to `insert_at`, `set_at`, and `remove_at` on the partial path and write the coordinates
  back through the existing drawing callback;
- let Google's native vertex handle retain its move/hand cursor.

In CSS, replace the repeating dashed excluded legend swatch with a solid gray line at the same
opacity as the map.

Add `lib/territory-map-style.test.ts` to the web test command.

- [ ] **Step 4: Run focused and canonical checks**

Run:

```powershell
pnpm --dir web test
pnpm --dir web typecheck
pnpm --dir web lint
```

Expected: PASS.

- [ ] **Step 5: Commit the map interaction slice**

```powershell
git add web/lib/territory-map-style.ts web/lib/territory-map-style.test.ts web/components/TerritoryMap.tsx web/app/globals.css web/package.json
git commit -m "fix: clarify territory map drawing"
```

### Task 6: Show the long-running import honestly and preserve the browser draft

**Files:**
- Modify: `web/components/TerritoryEditor.tsx`
- Modify: `web/app/globals.css`

**Interfaces:**
- Save remains enabled for a proof workspace even when no field has changed.
- Exact busy copy: `Importing streets and addresses…`.
- Failed requests leave the current React draft untouched.

- [ ] **Step 1: Add the minimum import-aware UI state**

Use the already-tested `needsTerritoryImport` helper against the saved workspace and current
draft:

```ts
const importRequired = needsTerritoryImport(savedWorkspace.import, draft);
const canSave = dirty || importRequired;
const [importing, setImporting] = useState(false);
```

At save time, calculate `importRequired` before issuing the request:

```ts
async function save() {
  const willImport = needsTerritoryImport(savedWorkspace.import, draft);
  setSaving(true);
  setImporting(willImport);
  try {
    const response = await fetch('/api/territory', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(draft),
    });
    if (!response.ok) throw new Error('Could not save territory changes');
    const saved = (await response.json()) as TerritoryWorkspace;
    setSavedWorkspace(saved);
    setDraft(workspaceToDraft(saved));
  } catch {
    setSaveError('Could not save territory changes. Your draft is still here.');
  } finally {
    setSaving(false);
    setImporting(false);
  }
}
```

Do not clear or rebuild the draft in the error path.

When `importRequired && !importing`, show:

```tsx
<p className="import-notice">Street data will refresh when saved.</p>
```

When importing, render a blocking status over the editor:

```tsx
<div className="import-status" role="status" aria-live="polite">
  Importing streets and addresses…
</div>
```

Set `aria-busy={importing}` and `inert={importing}` on the controls/map region,
and disable Save and Cancel while the request is active. Do not add percentage progress or a
second endpoint.

- [ ] **Step 2: Run static and production checks**

Run:

```powershell
pnpm --dir web typecheck
pnpm --dir web lint
pnpm --dir web build
```

Expected: PASS.

- [ ] **Step 3: Commit the import UI**

```powershell
git add web/components/TerritoryEditor.tsx web/app/globals.css
git commit -m "feat: show territory import state"
```

### Task 7: Exercise one genuine import and stop at founder review

**Files:**
- Modify: `README.md`
- Modify: `ENVIRONMENTS.md`
- Modify: `docs/superpowers/specs/2026-07-27-territory-setup-design.md`
- Modify: `IMPLEMENTATION_PLAN.md`

**Interfaces:**
- Documents: importer installation and `STREETLIGHT_PYTHON`.
- Records: actual imported segment/home counts and verification date.
- Sets: Phase 2 status to `Awaiting human review`.

- [ ] **Step 1: Document the one extra local prerequisite**

Add:

```powershell
python -m pip install -r web/importer/requirements.txt
```

Document `STREETLIGHT_PYTHON` as optional and only needed when `python` is not the desired
executable. State that Overture import needs network access but no API key.

- [ ] **Step 2: Run one real pilot import through the website**

Start from a migrated and seeded local database:

```powershell
pnpm db:migrate
pnpm db:seed
pnpm dev
```

At `http://localhost:3000/territory`:

1. Keep the pilot church address.
2. Set the radius to 1 mile for the bounded review import.
3. Click `Save changes`.
4. Verify `Importing streets and addresses…` remains visible until the request completes.
5. Record the returned segment and estimated-home totals in the Phase 2 evidence.
6. Restart the dev server and verify the real imported set remains unchanged.
7. Reduce the radius and save; verify the import completion timestamp does not change.
8. Add/edit an exclusion and save; verify the timestamp still does not change.
9. Increase the radius beyond the imported footprint; verify the timestamp changes after a
   successful replacement.

- [ ] **Step 3: Verify the approved map behaviors in the real browser**

At broad and close zoom levels, verify:

- road names remain readable through the semi-transparent segment lines;
- active segments are solid orange and excluded segments are solid gray;
- the legend matches those solid styles;
- line weights scale from roughly 2px to 5px;
- the first exclusion point appears immediately;
- the first and second partial vertices can be dragged;
- the map uses a crosshair while adding points and Google's hand/move cursor on vertices;
- an invalid or self-crossing polygon remains unsaveable;
- existing polygons do not move when the address changes.

- [ ] **Step 4: Verify failure preservation**

Temporarily start the server process with `STREETLIGHT_PYTHON` set to a nonexistent executable,
expand the radius, and save. Verify:

- the browser reports failure and retains the complete draft;
- reloading returns the previously saved address, radius, exclusions, import timestamp, and
  segment set;
- no partial segment replacement is present.

Restart with the valid Python executable immediately after this check.

- [ ] **Step 5: Run the canonical repository check**

Run:

```powershell
pnpm check
git diff --check
```

Expected: all tests, lint, typecheck, and production build PASS; no whitespace errors.

- [ ] **Step 6: Record evidence and set the checkpoint**

In both product-planning documents:

- record the pinned release;
- record the real import counts and review radius;
- list the automated commands and browser checks;
- set Phase 2 to `Awaiting human review`;
- leave Phase 3 untouched.

- [ ] **Step 7: Commit the verified checkpoint**

```powershell
git add README.md ENVIRONMENTS.md docs/superpowers/specs/2026-07-27-territory-setup-design.md IMPLEMENTATION_PLAN.md
git commit -m "docs: record territory import review evidence"
```

- [ ] **Step 8: Stop**

Do not start Phase 3. Hand the running `/territory` page to the founder for review.
