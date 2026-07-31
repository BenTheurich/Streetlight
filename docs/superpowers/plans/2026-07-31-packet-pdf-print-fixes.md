# Packet PDF Print Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make production packet PDFs use the finalized open-map data and styling, fit each route tightly, preserve native road labels, show the starting house number, and remain legible when printed in grayscale.

**Architecture:** Reuse the existing Map Lab building/address matching in the packet renderer instead of creating a second matcher. Extend the immutable packet-generation snapshot with the accepted FEMA row gaps and source house numbers, then derive one display position that drives the camera, pin, and starting-number label. Advance a legacy batch to a building-bearing generation only through an exact segment/address parity migration.

**Tech Stack:** TypeScript, Node test runner, SQLite, MapLibre GL JS, Playwright, pdf-lib, Poppler.

## Global Constraints

- Produce one color PDF; do not add a separate black-and-white or one-bit output.
- Use a 512-pixel Web Mercator world, 1.20 bounds multiplier, and fractional zoom.
- Render only the starting house number; keep all other house numbers off packet maps.
- Read buildings and addresses from the packet's recorded import generation.
- Keep Streetlight deterministic and AI-free; add no provider or renderer abstraction.

---

### Task 1: Immutable map-data parity and starting display position

**Files:**
- Modify: `web/lib/database.ts`
- Create: `web/db/migrations/022_backfill_packet_map_generations.sql`
- Modify: `web/lib/packet-finalization.ts`
- Modify: `web/lib/open-map-style.ts`
- Test: `web/lib/batch-finalization.test.ts`
- Test: `web/lib/open-map-style.test.ts`

**Interfaces:**
- Produces: `PacketMapGeneration.houseNumbers` and accepted row-gap FEMA buildings for its recorded generation.
- Produces: `positionedHouseNumbers({ buildings, houseNumbers })` for both Map Lab and packet rendering.

- [x] **Step 1: Write failing tests**

```ts
assert.deepEqual(generation.houseNumbers, [
  { number: '1', street: 'Koa Court', position: [-117.117, 33.543] },
]);
assert.ok(generation.buildings.some(({ sourceId }) => sourceId === 'accepted-row-gap'));
assert.deepEqual(positionedHouseNumbers({ buildings, houseNumbers })[0].position, buildingCenter);
```

- [x] **Step 2: Run the focused tests and confirm the missing generation data/export fails**

Run from `web`: `node --experimental-strip-types --test lib/batch-finalization.test.ts lib/open-map-style.test.ts`

- [x] **Step 3: Reuse the existing accepted-gap filter and address matcher**

```ts
const buildings = [...storedBuildings, ...acceptedFemaGaps(importGeneration, overtureRelease)];
return { importGeneration, overtureRelease, networkSegments, buildings, houseNumbers };
```

- [x] **Step 4: Run the focused tests and confirm they pass**

Run from `web`: `node --experimental-strip-types --test lib/batch-finalization.test.ts lib/open-map-style.test.ts`

### Task 2: Fractional camera, native label order, pin number, and isolated captures

**Files:**
- Modify: `web/lib/open-map-style.ts`
- Modify: `web/lib/open-map-renderer.ts`
- Test: `web/lib/open-map-style.test.ts`
- Test: `web/lib/open-map-renderer.test.ts`

**Interfaces:**
- Produces: `packetStartDisplay(packet, generation)` returning `{ number, position }`.
- Consumes that position in `packetMapView(packet, position)` and `OpenMapRenderInput.start`.

- [x] **Step 1: Write failing behavior tests**

```ts
assert.ok(!Number.isInteger(packetMapView(longPacket).zoom));
assert.equal(style.layers.some(({ id }) => id === 'streetlight-route-labels'), false);
assert.ok(routeLayerIndex < nativeHighwayLabelIndex);
assert.match(packetMapDocument(input, script, css), />40192<\/div>/);
assert.deepEqual(render.start.position, centeredBuildingPosition);
```

- [x] **Step 2: Run the focused tests and confirm each new behavior fails for the expected reason**

Run from `web`: `node --experimental-strip-types --test lib/open-map-style.test.ts lib/open-map-renderer.test.ts`

- [x] **Step 3: Implement the minimum shared behavior**

```ts
const zoom = Math.log2(Math.min(1280 / (512 * paddedWidth), 1280 / (512 * paddedHeight)));
const start = packetStartDisplay(packet, generation);
const view = packetMapView(packet, start.position);
```

Keep the selected route below the unchanged native OpenMapTiles highway-name layers; do not add a route-label source or suppress native names. Add the starting number beneath the existing marker. Keep one browser per PDF request and one fresh Playwright page per packet.

- [x] **Step 4: Run the focused tests and confirm they pass**

Run from `web`: `node --experimental-strip-types --test lib/open-map-style.test.ts lib/open-map-renderer.test.ts`

### Task 3: PDF regression and visual verification

**Files:**
- Modify: `web/lib/packet-pdf.ts`
- Test: `web/lib/packet-pdf.test.ts`
- Output: `output/pdf/streetlight-pdf-review-10-varied-routes-v3.pdf`
- Output: `output/pdf/streetlight-pdf-review-grayscale.png`

**Interfaces:**
- Keeps `renderPacketPdf(selection, { logo, renderMap })` unchanged.

- [x] **Step 1: Preserve the failing long-address regression test**

```ts
assert.ok((182.028 / 12) * Number(street[1]) <= 169);
```

- [x] **Step 2: Run the PDF test and confirm the unfitted address fails**

Run from `web`: `node --experimental-strip-types --test lib/packet-pdf.test.ts`

- [x] **Step 3: Fit only overlong starting-address text before the QR panel**

```ts
size: Math.min(12, 169 / bold.widthOfTextAtSize(street, 1))
```

- [x] **Step 4: Run focused and canonical checks**

Run: `pnpm --dir web test`

Run: `pnpm --dir web typecheck`

Run: `pnpm --dir web lint`

Run: `git diff --check`

- [x] **Step 5: Generate and inspect representative output**

Generate ten packet pages with varied geographic extents, render every page to PNG, and create one grayscale conversion from a representative page. Verify road names, route fit, accepted buildings, the centered starting pin/number, attribution, QR/text layout, and grayscale contrast before handing the PDFs to the founder.

### Task 4: Collision-safe labels for selected streets missing a native label

**Files:**
- Modify: `web/lib/open-map-style.ts`
- Modify: `web/lib/open-map-renderer.ts`
- Test: `web/lib/open-map-style.test.ts`
- Test: `web/lib/open-map-renderer.test.ts`
- Modify: `docs/PRINT_MAP_RENDERING_GUIDE.md`
- Modify: `docs/superpowers/specs/2026-07-30-open-data-packet-pdf-design.md`

**Interfaces:**
- Produces: `streetlightRouteFallbackLabels`, one longest selected route feature per normalized street name.
- Consumes: visible native features from `highway-name-minor` and `highway-name-major` after the initial idle render.

- [x] **Step 1: Write failing behavior tests**

```ts
assert.equal(fallbackSource.data.features.length, 1);
assert.equal(style.layers.some(({ id }) => id === 'streetlight-route-fallback-labels'), false);
assert.match(html, /queryRenderedFeatures/);
assert.match(html, /text-allow-overlap.*false/);
assert.match(html, /symbol-avoid-edges.*true/);
```

- [x] **Step 2: Run the focused tests and confirm the fallback source and render pass are missing**

Run from `web`: `node --experimental-strip-types --test lib/open-map-style.test.ts lib/open-map-renderer.test.ts`

- [x] **Step 3: Implement the minimum two-pass render**

Add one dormant fallback source to the packet style. On the first `idle`, query the two native
highway-name layers, normalize visible and selected names by trimming, collapsing whitespace,
uppercasing, and expanding leading compass and common final suffix abbreviations, then add one
filtered `line-center` fallback symbol layer only for missing selected names. Keep
`text-allow-overlap` and `text-ignore-placement` false and `symbol-avoid-edges` true. Mark the map
ready only after the second `idle`, or immediately when no names are missing.

- [x] **Step 4: Run focused tests and regenerate the ten varied packet pages**

Run from `web`: `node --experimental-strip-types --test lib/open-map-style.test.ts lib/open-map-renderer.test.ts`

Run from the worktree root: `node --experimental-strip-types tmp/pdfs/render-current-newest.mjs`

- [x] **Step 5: Run the full verification and commit**

Run from `web`: `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build`.

Commit: `fix: add collision-safe packet label fallbacks`
