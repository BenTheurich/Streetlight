# Real-data Map Comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a browser-visible, three-panel comparison of one real Streetlight pilot packet using Google, OpenStreetMap, and OpenStreetMap enhanced with Overture buildings and house numbers.

**Architecture:** Two disposable scripts read the existing SQLite pilot database, retrieve the pinned Overture release and an OpenStreetMap basemap, and render equal-size PNG panels. A visual-companion HTML screen displays the panels and their provenance without changing production code or committing provider images, credentials, or geographic extracts.

**Tech Stack:** Node.js 22 with TypeScript stripping, Python 3.12 standard library, Pillow 12, DuckDB 1.5.5 with spatial/httpfs, SQLite, Google Maps Static/Roads, OpenStreetMap raster tiles, Overture GeoParquet.

## Global Constraints

- Use only actual provider and source data; do not invent, approximate for appearance, or image-generate geography.
- Use Streetlight's pinned Overture release `2026-06-17.0`.
- Give all three panels the same geographic bounds and `1280 × 1280` dimensions.
- Preserve visible provider attribution.
- Do not modify Streetlight's production renderer, schema, product documents, or provider configuration.
- Keep scripts and outputs under ignored `tmp/` and `.superpowers/` paths.
- If a provider cannot be retrieved or authenticated, report that failure instead of inserting a mock.

---

### Task 1: Extract the packet and source geography

**Files:**
- Create: `tmp/map-comparison/render_real_map_comparison.py`
- Read: `web/data/streetlight.db`
- Read: `web/lib/territory-import.ts`

**Interfaces:**
- Consumes: the newest finalized street packet in `web/data/streetlight.db`
- Produces: `tmp/map-comparison/source-data.json` containing `packet`, `bounds`, `buildings`, `addresses`, and `provenance`

- [ ] **Step 1: Add an assert-based database extraction check**

```python
def self_check(packet):
    assert packet["code"].startswith("TEM-")
    assert packet["segments"]
    assert len(packet["start"]["position"]) == 2
```

- [ ] **Step 2: Run the extractor before implementation**

Run:

```powershell
& $python tmp/map-comparison/render_real_map_comparison.py --extract-only
```

Expected: failure because the script does not exist.

- [ ] **Step 3: Implement the smallest source extractor**

Use `sqlite3.connect("file:...streetlight.db?mode=ro", uri=True)` to select the
first street packet in the newest finalized batch, its ordered
`street_segments.geometry_geojson`, and its persisted starting point. Compute
one padded bounding box from every segment coordinate and the start point.

Use DuckDB with `spatial` and `httpfs` to query:

```sql
SELECT id, ST_AsGeoJSON(geometry)
FROM read_parquet(
  's3://overturemaps-us-west-2/release/2026-06-17.0/theme=buildings/type=building/*',
  hive_partitioning = true
)
WHERE bbox.xmin <= ? AND bbox.xmax >= ?
  AND bbox.ymin <= ? AND bbox.ymax >= ?;
```

and:

```sql
SELECT id, number, street, ST_AsGeoJSON(geometry)
FROM read_parquet(
  's3://overturemaps-us-west-2/release/2026-06-17.0/theme=addresses/type=address/*',
  hive_partitioning = true
)
WHERE number IS NOT NULL
  AND bbox.xmin <= ? AND bbox.xmax >= ?
  AND bbox.ymin <= ? AND bbox.ymax >= ?;
```

Write the packet code, bounding box, Overture release, retrieval timestamp, and
raw features to `source-data.json`.

- [ ] **Step 4: Run the source check**

Run:

```powershell
$env:PYTHONPATH = (Resolve-Path tmp/benchmark-venv/Lib/site-packages).Path
& $python tmp/map-comparison/render_real_map_comparison.py --extract-only
```

Expected: the script prints one real packet code plus non-zero building and
numbered-address counts, and `self_check` passes.

### Task 2: Render equal-bounds source panels

**Files:**
- Modify: `tmp/map-comparison/render_real_map_comparison.py`
- Create: `tmp/map-comparison/render_google_panel.ts`
- Read: `web/lib/packet-pdf.ts`
- Read: `web/lib/google-maps-server.ts`

**Interfaces:**
- Consumes: `source-data.json`
- Produces: `google.png`, `osm.png`, `osm-overture.png`, and `validation.json`

- [ ] **Step 1: Add rendering assertions**

```python
def validate_images(images, bounds, building_count, address_count):
    assert all(image.size == (1280, 1280) for image in images)
    assert len(bounds) == 4 and bounds[0] < bounds[2] and bounds[1] < bounds[3]
    assert building_count > 0
    assert address_count > 0
```

- [ ] **Step 2: Verify the checks fail before the renderer exists**

Run the script without `--extract-only`.

Expected: failure because no image panels have been written.

- [ ] **Step 3: Render the two open-data panels**

Implement Web Mercator tile-to-pixel conversion using `math`, retrieve only the
OpenStreetMap tiles intersecting the selected bounds with an identifying
Streetlight comparison `User-Agent`, stitch and crop them with Pillow, then
draw:

- the same orange packet segments and start marker on both panels;
- actual Overture polygons with a neutral fill and outline on the enhanced panel;
- actual Overture `number` values at their source points on the enhanced panel;
- conservative label collision rejection using occupied pixel rectangles;
- `© OpenStreetMap contributors` and
  `© OpenStreetMap contributors, Overture Maps Foundation` respectively.

- [ ] **Step 4: Render the Google baseline**

Have `render_google_panel.ts` load the real packet via
`getPacketDownloadSelection("newest")`, call the existing
`renderPacketMap(packet, getGoogleMapsServerKey())`, and write the returned PNG.
The script must print only the provider status, never the API key.

If no configured Google server key is available, write `google-error.json` and
use an actual Google Maps web capture of the identical bounds for the comparison,
labeling it `Google Maps web capture — API renderer credential unavailable`.
Do not use a generated placeholder or an unrelated map.

- [ ] **Step 5: Validate provenance and geometry**

Run:

```powershell
node --experimental-strip-types tmp/map-comparison/render_google_panel.ts
$env:PYTHONPATH = (Resolve-Path tmp/benchmark-venv/Lib/site-packages).Path
& $python tmp/map-comparison/render_real_map_comparison.py
```

Expected:

- three `1280 × 1280` panels;
- matching stored bounds for every panel;
- identical packet segment and start-point inputs;
- non-zero Overture feature counts;
- three sampled building IDs and three sampled numbered-address IDs recorded in
  `validation.json`;
- no provider key in console output or artifacts.

### Task 3: Publish the verified visual comparison

**Files:**
- Create: `.superpowers/brainstorm/win-map-comparison-20260730/content/google-real.png`
- Create: `.superpowers/brainstorm/win-map-comparison-20260730/content/osm-real.png`
- Create: `.superpowers/brainstorm/win-map-comparison-20260730/content/osm-overture-real.png`
- Create: `.superpowers/brainstorm/win-map-comparison-20260730/content/real-map-comparison.html`

**Interfaces:**
- Consumes: the three PNGs and `validation.json`
- Produces: one authenticated visual-companion screen

- [ ] **Step 1: Confirm the companion is alive**

Check that `state/server-info` exists and `state/server-stopped` does not.
Restart the same project session before publishing if necessary.

- [ ] **Step 2: Copy verified images into the companion content directory**

Use distinct semantic filenames. Never embed provider credentials or raw source
extracts in the served directory.

- [ ] **Step 3: Add the comparison screen**

Create a full HTML document containing three equal-width cards. Each card must
show its provider, source-data attribution, exact panel status, and the same
packet code. Beneath the enhanced panel, show the actual building and numbered
address counts from `validation.json`.

- [ ] **Step 4: Perform the final visual and file check**

Open the authenticated companion URL and verify that all images load at full
resolution, attribution is readable, the orange route and marker align, and no
panel is stretched or cropped differently.

- [ ] **Step 5: Present the evidence**

Give the user the authenticated companion URL, the packet code, Overture release,
feature counts, and any provider limitation encountered. Ask for their visual
assessment without changing Streetlight's production provider.

### Task 4: Refine the custom vector road treatment

**Files:**
- Modify: `tmp/map-comparison/render_custom_vector_map.cjs`
- Regenerate: `tmp/map-comparison/custom-vector.png`
- Replace: `.superpowers/brainstorm/win-map-comparison-20260730/content/custom-vector-real.png`

**Interfaces:**
- Consumes: the existing OpenFreeMap vector style plus the verified Overture/FEMA geometry
- Produces: the same `1280 × 1280` panel with wider roads, brighter labels, and an unlabeled start pin

- [ ] **Step 1: Refine only the approved style values**

Use one shared class-and-zoom width system for the basemap and highlighted
packet segments. At zoom 18, residential/minor roads use `31` pixels, service
roads `12`, tracks `8`, paths `6`, and major roads `39`; every value interpolates
at other zooms. Preserve each packet segment's stored `road_class`, map it to
the matching curve, and remove the route, major-road, and motorway casings.

- [ ] **Step 2: Make the start marker production-faithful**

Remove the `40192` marker pill and reduce the custom marker to one compact,
unlabeled green teardrop. Do not change the persisted start coordinate.

- [ ] **Step 3: Regenerate and verify**

Run:

```powershell
$env:NODE_PATH='C:\Users\benth\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules'
& 'C:\Users\benth\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' '.\tmp\map-comparison\render_custom_vector_map.cjs'
```

Expected: `236 Overture + 5 FEMA buildings`, a `1280 × 1280` PNG, zero blue
markers, no address-number pill, unchanged bounds, and legible white road names.

### Task 5: Restore rounded topology-aware terminal caps

**Files:**
- Modify: `tmp/map-comparison/render_real_map_comparison.py`
- Modify: `tmp/map-comparison/render_custom_vector_map.cjs`
- Modify: `tmp/map-comparison/test_custom_vector_style.cjs`
- Regenerate: `tmp/map-comparison/source-data.json`
- Regenerate: `tmp/map-comparison/custom-vector.png`
- Replace: `.superpowers/brainstorm/win-map-comparison-20260730/content/custom-vector-real.png`

**Interfaces:**
- Consumes: every selected segment's stored coordinates and the complete
  territory segment connector references
- Produces: immutable source geometry plus a derived display geometry whose
  compensated rounded cap ends at the original confirmed junction coordinate

- [ ] **Step 1: Add failing cap and label contracts**

Assert that source geometry remains byte-for-byte equal to the packet geometry,
cul-de-sac or ambiguous endpoints remain uncompensated, only selected-terminal
endpoints with a non-selected connector continuation are compensated, the line
cap is `round`, label sizes are `12`, `17`, and `19` at zooms `14`, `18`, and
`20`, label fill is `#ffffff`, and halo width is `1`.

- [ ] **Step 2: Run the style contract and verify failure**

```powershell
& 'C:\Users\benth\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' tmp\map-comparison\test_custom_vector_style.cjs
```

Expected: failure because the current route uses butt caps and the old label
sizes and halo.

- [ ] **Step 3: Export connector-continuation evidence**

Extend the read-only comparison extractor to include enough nearby normalized
segment topology to classify each selected endpoint as `selected_join`,
`network_continuation`, `network_end`, or `ambiguous`. Do not infer
continuation from street names or pixel positions.

- [ ] **Step 4: Derive zoom-aware display geometry**

Keep the source geometry unchanged. For each `network_continuation` terminal,
move only the derived display endpoint inward along the geodesic line by half
the class-and-zoom stroke width converted from pixels to meters at the final
map latitude. Leave every other endpoint unchanged and render with round caps.

- [ ] **Step 5: Refine the labels**

Set label fill to `#ffffff`, halo width to `1`, and the continuous text-size
expression to `14:12`, `18:17`, and `20:19`.

- [ ] **Step 6: Regenerate and verify**

Run the extractor, renderer, and style contract. Confirm `236 Overture + 5 FEMA
buildings`, unchanged bounds and source coordinates, round cul-de-sac caps,
compensated confirmed-junction caps, and no console errors. Replace the
companion PNG and advance its cache key.
