# Streetlight Phase 2 Territory Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved, persistent radius-minus-exclusions territory editor on an
interactive Google map and stop at the Phase 2 founder-review checkpoint.

**Architecture:** Keep the Phase 1 Next.js and SQLite application. The server returns one
church-owned territory workspace; the browser holds a complete unsaved draft and calculates
live eligibility from deterministic geometry functions. One PATCH replaces the saved radius
and exclusion set in a transaction. The browser uses the native Google Maps JavaScript API
directly, without a map wrapper or generalized GIS layer.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, Node 22 built-in SQLite,
native Google Maps JavaScript API, Node's built-in test runner, Biome.

## Global Constraints

- `PRODUCT.md` is the product authority.
- Implement only Phase 2; the coverage heatmap remains Phase 3.
- The setup page uses a circular radius from 1 through 20 miles and polygon exclusions.
- A segment is radius-eligible only when its complete line lies inside or on the circle.
- Any segment contact with an exclusion polygon excludes the whole segment.
- Imported segment geometry and estimated home counts remain read-only.
- Live map changes are drafts; only `Save changes` persists the complete draft atomically.
- `Cancel` restores the last saved draft.
- Existing exclusion polygons retain their coordinates when the church address changes.
- The application remains deterministic and AI-free.
- Use the Google Maps JavaScript API directly; do not add a map library or provider abstraction.
- Automated checks and production builds must work without Google credentials.

---

## File Structure

- `web/lib/territory-geometry.ts`: GeoJSON types and deterministic circle/polygon predicates.
- `web/lib/territory-geometry.test.ts`: focused geometry regression checks.
- `web/lib/database.ts`: workspace read model and atomic complete-draft save.
- `web/lib/territory-draft.ts`: request-boundary parsing and validation.
- `web/lib/google-maps-server.ts`: read server/browser key configuration and geocode an address.
- `web/lib/google-maps-server.test.ts`: mock-fetch geocoding checks.
- `web/db/migrations/002_territory_setup.sql`: add the Phase 2 address, source ID, and exclusion table.
- `web/db/seed.mjs`: import the committed Phase 0 segment fixture idempotently.
- `web/db/database.test.mjs`: verify the Phase 2 church-owned seed graph.
- `web/app/api/territory/route.ts`: GET the workspace and PATCH one validated complete draft.
- `web/app/api/geocode/route.ts`: server-only address lookup endpoint.
- `web/components/TerritoryMap.tsx`: Google map lifecycle and native overlays.
- `web/components/TerritoryEditor.tsx`: draft state, controls, exclusion list, save/cancel behavior.
- `web/app/territory/page.tsx`: server-rendered Territory Setup entry point.
- `web/app/page.tsx`: minimal separate Coverage Dashboard stub and link to setup.
- `web/app/globals.css`: exact approved two-region page layout and interaction states.
- `ENVIRONMENTS.md`: browser/server key names and restrictions.
- `README.md`: Phase 2 local setup and review URL.
- `IMPLEMENTATION_PLAN.md`: Phase 2 status, evidence, and founder-review instructions.

### Task 1: Deterministic eligibility geometry

**Files:**
- Modify: `web/lib/territory-geometry.ts`
- Create: `web/lib/territory-geometry.test.ts`
- Modify: `web/package.json`

**Interfaces:**
- Produces: `Position`, `LineString`, and `Polygon` GeoJSON types.
- Produces: `closePolygon(points: Position[]): Polygon`.
- Produces: `lineInsideCircle(line: LineString, center: Position, radiusMiles: number): boolean`.
- Produces: `lineIntersectsPolygon(line: LineString, polygon: Polygon): boolean`.
- Produces: `polygonIsSimple(polygon: Polygon): boolean`.

- [x] **Step 1: Write failing circle and polygon tests**

```ts
test('circle containment includes the boundary and rejects a crossing line', () => {
  assert.equal(lineInsideCircle(line([[-117, 33], [-117, 33.01]]), [-117, 33], 1), true);
  assert.equal(lineInsideCircle(line([[-117, 33], [-117, 33.03]]), [-117, 33], 1), false);
});

test('polygon contact excludes a whole segment and bow-ties are invalid', () => {
  assert.equal(lineIntersectsPolygon(line([[-1, 0], [1, 0]]), square), true);
  assert.equal(polygonIsSimple(bowTie), false);
});
```

- [x] **Step 2: Run the focused test and verify it fails**

Run: `pnpm --dir web exec node --experimental-strip-types --test lib/territory-geometry.test.ts`

Expected: FAIL because `lineInsideCircle` and `polygonIsSimple` are not exported.

- [x] **Step 3: Replace prototype-only projection/editor helpers with the minimum geometry core**

Use a haversine distance for circle containment. Treat polygon boundaries as inside/contact,
close rings exactly once, and reject self-intersections between non-adjacent edges. Retain the
prototype-only helpers until Task 2 replaces their final callers.

```ts
export function lineInsideCircle(
  line: LineString,
  center: Position,
  radiusMiles: number,
): boolean {
  return line.coordinates.every((point) => distanceMiles(point, center) <= radiusMiles + 1e-9);
}
```

- [x] **Step 4: Add the focused test to the canonical test command and run it**

Run: `pnpm --dir web test`

Expected: PASS for database, territory geometry, and the existing prototype persistence test.

- [x] **Step 5: Commit the geometry slice**

```bash
git add web/lib/territory-geometry.ts web/lib/territory-geometry.test.ts web/package.json
git commit -m "feat: define territory eligibility geometry"
```

### Task 2: Complete-draft validation and atomic persistence

**Files:**
- Modify: `web/db/migrations/002_territory_setup.sql`
- Modify: `web/db/seed.mjs`
- Modify: `web/db/database.test.mjs`
- Modify: `web/lib/database.ts`
- Create: `web/lib/territory-draft.ts`
- Replace: `web/lib/territory.test.ts`
- Modify: `web/app/api/territory/route.ts`

**Interfaces:**
- Consumes: Task 1 `Position`, `LineString`, `Polygon`, `lineInsideCircle`,
  `lineIntersectsPolygon`, and `polygonIsSimple`.
- Produces: `ExclusionArea { id: string; name: string; geometry: Polygon }`.
- Produces: `TerritoryWorkspace` with saved center/radius/exclusions and derived segment totals.
- Produces: `TerritoryDraftInput { originAddress; center; radiusMiles; exclusions }`.
- Produces: `parseTerritoryDraft(value: unknown): TerritoryDraftInput`.
- Produces: `saveTerritoryDraft(draft: TerritoryDraftInput, filename?: string): void`.

- [x] **Step 1: Replace the prototype persistence test with failing complete-draft checks**

The test creates a temporary database, saves a smaller radius and two exclusions in one call,
reloads, verifies the exact draft, checks live totals, then saves a renamed/reshaped/deleted
set. It also verifies that a thrown insert rolls back the radius and exclusions together.

```ts
saveTerritoryDraft({
  originAddress: initial.originAddress,
  center: initial.center,
  radiusMiles: 1,
  exclusions: [{ id: 'exclude-test', name: 'School', geometry: square }],
}, filename);
assert.equal(getTerritoryWorkspace(filename).exclusions[0].name, 'School');
```

- [x] **Step 2: Run the focused persistence test and verify it fails**

Run: `pnpm --dir web exec node --experimental-strip-types --test lib/territory.test.ts`

Expected: FAIL because the complete-draft API does not exist.

- [x] **Step 3: Simplify the migration and seed to read-only imported street data**

Keep `source_segment_id`, `geometry_geojson`, and `estimated_homes`. Remove the prototype's
duplicate editable/imported columns. Keep the internal SQL table name `ignore_zones`; expose
those rows as `exclusions` in the setup-page contract.

- [x] **Step 4: Implement the workspace query and transaction**

`getTerritoryWorkspace()` derives eligibility from the saved center/radius and every exclusion.
`saveTerritoryDraft()` uses `BEGIN IMMEDIATE`, updates address/center/radius plus the derived
circle GeoJSON, replaces the church territory's exclusions, and commits. Every failure rolls
back before rethrowing.

- [x] **Step 5: Add request-boundary validation**

`parseTerritoryDraft()` rejects unknown shapes, an empty or 300+ character address, coordinates
outside WGS84 limits, radius outside 1–20, duplicate exclusion IDs, more than 100 exclusions,
names over 100 characters, rings outside 4–200 closed positions, and self-intersections.

- [x] **Step 6: Replace action-based PATCH with one complete-draft PATCH**

```ts
export async function PATCH(request: Request) {
  try {
    saveTerritoryDraft(parseTerritoryDraft(await request.json()));
    return Response.json(getTerritoryWorkspace());
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 400 });
  }
}
```

There is no segment-update route.

- [x] **Step 7: Run database, draft, and canonical checks**

Run: `pnpm --dir web test`

Expected: PASS, including ownership, radius containment, polygon contact, rename/reshape/delete,
rollback, and read-only imported data checks.

Run: `pnpm --dir web typecheck`

Expected: PASS.

- [x] **Step 8: Commit the persistence slice**

```bash
git add web/db web/lib/database.ts web/lib/territory-draft.ts web/lib/territory.test.ts web/app/api/territory/route.ts
git commit -m "feat: persist complete territory drafts"
```

### Task 3: Server-only address lookup and map configuration

**Files:**
- Create: `web/lib/google-maps-server.ts`
- Create: `web/lib/google-maps-server.test.ts`
- Create: `web/app/api/geocode/route.ts`
- Modify: `web/package.json`
- Modify: `ENVIRONMENTS.md`

**Interfaces:**
- Produces: `getGoogleMapsBrowserKey(): string` from
  `GOOGLE_MAPS_BROWSER_API_KEY`.
- Produces: `geocodeAddress(address: string, fetcher = fetch): Promise<GeocodedAddress>`.
- Produces: `POST /api/geocode` returning
  `{ formattedAddress: string; center: Position }`.

- [x] **Step 1: Write failing mock-fetch geocoding tests**

```ts
const result = await geocodeAddress('31087 Nicolas Rd', mockSuccessfulFetch);
assert.deepEqual(result.center, [-117.116885, 33.54293]);
await assert.rejects(() => geocodeAddress('missing', mockZeroResultsFetch), /could not/i);
```

- [x] **Step 2: Run the focused test and verify it fails**

Run: `pnpm --dir web exec node --experimental-strip-types --test lib/google-maps-server.test.ts`

Expected: FAIL because `google-maps-server.ts` does not exist.

- [x] **Step 3: Implement server-only Geocoding API lookup**

Read `GOOGLE_MAPS_SERVER_API_KEY`, with the existing
`GOOGLE_MAPS_STATIC_API_KEY` accepted only as a local server-side fallback. Never return this
key. Encode the submitted address, require Google status `OK`, and return only formatted
address and longitude/latitude.

- [x] **Step 4: Add the POST route and document key restrictions**

The browser key is intended to be visible and must be restricted to Maps JavaScript API plus
approved HTTP referrers. The server key must be restricted to Geocoding/Static Maps/Roads and
must not have browser referrers.

- [x] **Step 5: Run the focused and canonical tests**

Run: `pnpm --dir web test`

Expected: PASS without live credentials or network access.

- [x] **Step 6: Commit the Google configuration slice**

```bash
git add web/lib/google-maps-server.ts web/lib/google-maps-server.test.ts web/app/api/geocode/route.ts web/package.json ENVIRONMENTS.md
git commit -m "feat: add server-side territory geocoding"
```

### Task 4: Interactive Territory Setup page

**Files:**
- Create: `web/components/TerritoryMap.tsx`
- Replace: `web/components/TerritoryEditor.tsx`
- Create: `web/app/territory/page.tsx`
- Replace: `web/app/page.tsx`
- Replace: `web/app/globals.css`
- Modify: `web/app/layout.tsx`
- Remove: `web/app/api/territory-map/route.ts`
- Modify: `web/biome.json`
- Modify: `web/tsconfig.json`

**Interfaces:**
- Consumes: Task 2 `TerritoryWorkspace`, `ExclusionArea`, and geometry helpers.
- Consumes: Task 3 browser key and `/api/geocode`.
- Produces: `<TerritoryMap apiKey draft segments mode selectedExclusionId ... />`.
- Produces: `<TerritoryEditor initialData mapsApiKey />`.

- [ ] **Step 1: Make the new route fail visibly before adding its page**

Run: `pnpm --dir web build`

Expected: the existing application still builds only the rejected root static-map prototype;
there is no `/territory` route or interactive Google map.

- [ ] **Step 2: Add the separate setup route and dashboard stub**

`/territory` loads the workspace and browser key on the server. `/` remains a minimal Coverage
Dashboard stub with one `Territory setup` link; it does not implement Phase 3 colors or
statistics.

- [ ] **Step 3: Load the native Google map without a wrapper**

Create one script promise per page, initialize a normal interactive road map, and render a
clear unavailable state when the browser key is absent or Google fails to load. Automated
builds must not contact Google.

- [ ] **Step 4: Render radius, church marker, segments, and exclusion overlays**

Use native `google.maps.Circle`, `Marker`, `Polyline`, and editable `Polygon` objects. Eligible
segments are solid orange; excluded segments are gray with a distinct dash pattern. Keep the
legend visible. Recalculate styles and totals from the browser draft whenever the radius,
center, or polygon coordinates change.

- [ ] **Step 5: Implement the single polygon drawing/editing flow**

`Pan` is the default mode. `Draw exclusion` adds map-click coordinates. At three distinct
points, enable `Finish polygon`; support undo/cancel. Reject a self-intersection while keeping
the draft editable. Finishing adds `Excluded area N`. Selecting a list/map polygon exposes
editable vertices, name, affected counts, `Done editing`, and `Delete`.

For keyboard input, `Enter` adds the current map-center point in draw mode, polygon rows and
actions remain keyboard reachable, and focused native map controls retain Google pan/zoom.

- [ ] **Step 6: Implement address, radius, save, cancel, and navigation protection**

The slider and numeric field share one 1–20 value. `Change` opens a focused address lookup;
`Use address` confirms the new center while preserving polygon coordinates. `Save changes`
PATCHes the whole draft. `Cancel` restores `initialData`. A `beforeunload` handler warns only
when the serialized draft differs from the saved workspace.

- [ ] **Step 7: Run formatter, lint, typecheck, tests, and production build**

Run: `pnpm --dir web exec biome check --write app components lib db`

Run: `pnpm check`

Expected: every command passes without a Google credential.

- [ ] **Step 8: Commit the interactive page**

```bash
git add web/app web/components web/lib web/biome.json web/tsconfig.json
git commit -m "feat: build interactive territory setup"
```

### Task 5: Real-browser verification and Phase 2 checkpoint

**Files:**
- Modify: `README.md`
- Modify: `IMPLEMENTATION_PLAN.md`

**Interfaces:**
- Consumes: the complete Phase 2 application.
- Produces: an `Awaiting human review` Phase 2 row with exact automated and browser evidence.

- [ ] **Step 1: Start the genuine local server**

Run: `pnpm dev`

Expected: migration and seed complete, then Next.js listens on `http://localhost:3000`.

- [ ] **Step 2: Verify the unavailable-map path if no browser key is configured**

Open `http://localhost:3000/territory`.

Expected: the setup controls and saved data load, and the map panel clearly requests browser
map configuration without crashing or exposing a server key.

- [ ] **Step 3: Verify the full approved workflow with the configured browser key**

Pan/zoom; drag and type the radius; draw, undo, finish, rename, reshape, and delete a polygon;
cancel and confirm restoration; save and reload; change the address and confirm old polygon
coordinates remain fixed. Check mobile-width layout, keyboard focus, and the browser console.

- [ ] **Step 4: Run the final canonical check**

Run: `pnpm check`

Expected: lint, typecheck, Node tests, and production build all pass.

- [ ] **Step 5: Update repository instructions and phase evidence**

Document `/territory`, both key names, and the local review flow. Change Phase 2 from
`In progress` to `Awaiting human review`, recording exact check counts and browser evidence.
Do not mark it `Complete`; only the founder can approve the phase.

- [ ] **Step 6: Commit the checkpoint**

```bash
git add README.md ENVIRONMENTS.md IMPLEMENTATION_PLAN.md
git commit -m "docs: prepare phase 2 founder review"
```

- [ ] **Step 7: Stop for human review**

Give the founder the URL and the Phase 2 human-review checklist. Do not start Phase 3.
