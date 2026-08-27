# Open-data packet PDF maps

Status: founder-approved design

Approved: 2026-07-30

Updated: 2026-07-31

Implementation reference: [`docs/PRINT_MAP_RENDERING_GUIDE.md`](../../PRINT_MAP_RENDERING_GUIDE.md)

## Purpose

Replace the Google Roads and Google Static Maps image in finalized packet PDFs with the
founder-approved open-data map. The new image must preserve the existing one-page packet layout,
use real building polygons, remain deterministic across repeat downloads, and be suitable for
paper use at different packet extents.

This project originally changed the printed map only. The later founder-approved Phase 9 migration
also applies the same shared open-data road and label presentation to the authenticated Map view,
while Google labeled hybrid remains the on-demand Satellite view. The Google Maps directions QR
code remains unchanged.

## Product decision

The open-data renderer becomes the only production renderer for packet PDF maps after the migration
passes its automated, visual, print, licensing, and founder-review gates.

Streetlight produces one color PDF. Its contrast must remain legible when a church prints that PDF
in grayscale; there is no separate black-and-white file or one-bit rendering mode.

The production stack is deliberately specific:

- MapLibre GL JS renders the map in headless Chromium.
- A repository-pinned copy of the approved OpenFreeMap Positron style is the basemap starting point.
- OpenFreeMap hosts the OpenMapTiles vector tiles, sprites, and fonts used by that style.
- OpenStreetMap supplies the basemap geography distributed through OpenFreeMap.
- Overture supplies Streetlight road geometry, addresses, and preferred building footprints.
- FEMA USA Structures supplies only deterministic, accepted U.S. building fallbacks.
- Streetlight supplies packet bounds, route styling, endpoint treatment, the starting pin, and
  printed attribution.

There is no generic map-provider interface, Google fallback, guessed building layer, or separate
rendering service in this design.

## Existing behavior that remains authoritative

`PRODUCT.md` continues to define packet content. Each finalized packet remains exactly one PDF
page containing:

- packet identifier;
- starting address as text;
- Google Maps directions QR code for that address;
- estimated home and tract count;
- every selected street segment;
- one starting-point marker;
- required attribution; and
- the Streetlight footer treatment: wordmark at left, packet identifier at right, and the centered
  default `Ye are the light of the world.` / `Matthew 5:14` brand verse between them.

The verse uses the approved two-line Option A treatment: Georgia Italic at 10 points for the verse
and Trebuchet Bold at approximately 6.25 points for the reference. Until the deferred church-wide
print settings are implemented in Phase 10, this default is fixed. Phase 10 may add one saved
church-wide footer message and one optional reference; it must retain this default when unchanged
and must not add per-batch overrides.

The existing PDF layout and `pdf-lib` assembly in `web/lib/packet-pdf.ts` remain in place. Only the
function that supplies the map PNG changes. Repeat download remains read-only and never changes
packet, reservation, or coverage data.

The map renders only the packet's starting house number, beneath the starting pin. The renderer
reuses the interactive open map's deterministic address-to-building positioning rule for both. When the match is
unambiguous, the pin and number use the building display point; otherwise they remain at the stored
address coordinate. No other house numbers render.

## Persisted building data

### Import generation

The existing territory import gains one additional output: display building polygons. A complete
import generation contains its normalized street segments, segment addresses, apartment
complexes, Overture buildings, and any accepted FEMA fallbacks.

For a U.S. territory, Overture and FEMA retrieval are both required before a new generation can
become current. If either source request fails, pagination is incomplete, or the import cannot pass
its existing completeness checks, Streetlight rejects the new generation and retains the previous
current generation unchanged.

Outside FEMA USA Structures coverage, the import explicitly records `overture_only` building mode
and does not attempt FEMA matching. This is a known geographic limitation, not a silent fallback.
Store the current generation's mode beside the territory's existing import metadata so a generation
with zero accepted fallbacks is still unambiguous.

All external retrieval and normalization finish before the database transaction that activates a
generation. Roads, addresses, apartments, and buildings then become current atomically. A failed
transaction exposes none of the candidate generation.

### Building records

Add one ordinary SQLite table, `map_buildings`, versioned by the territory's existing
`import_generation`. Each row stores:

- church ID and territory ID;
- import generation;
- source, restricted to `overture` or `fema`;
- source feature ID;
- Polygon or MultiPolygon GeoJSON in WGS84;
- the pinned Overture release used by the import; and
- retrieval time.

FEMA rows additionally store the provenance that justified their inclusion:

- matched numbered Overture address source ID;
- measured point-to-polygon distance in meters;
- `PRIM_OCC`;
- `OUTBLDG`;
- any spacing, setback, area, and compactness measurements required by the accepted rule; and
- FEMA source, product date, and image date when supplied.

The combination of church, territory, generation, source, and source feature ID is unique. Source
identity remains data, not a visual distinction; accepted Overture and FEMA buildings use the same
map style.

Old building generations remain initially because finalized packets may reference them. Do not add
cleanup until retained-data size has been measured and a safe retention rule is designed.

### FEMA acceptance

FEMA matching runs once during import, never during PDF download. It uses the two exact,
deterministic rules in `PRODUCT.md` and `docs/PRINT_MAP_RENDERING_GUIDE.md`.

The direct rule is:

1. Consider only numbered Overture addresses.
2. If an Overture building is within 10 meters of the address point, add no fallback.
3. Otherwise, find the nearest FEMA polygon.
4. Accept it only if it is within 10 meters, has
   `PRIM_OCC === "Single Family Dwelling"`, and is not an outbuilding.
5. Deduplicate accepted rows by FEMA `BUILD_ID`.
6. Store the matched address and distance as provenance.

The same-side row-gap rule may additionally accept an addressed FEMA polygon when it passes every
documented 5-meter footprint-separation, same-side neighbor, spacing, setback, area, and compactness
limit. Store its full provenance. These thresholds are global product rules, not values tuned per
route or screenshot.

An unmatched address produces no marker, rectangle, or estimated footprint.

## Finalized packet snapshot

Finalizing a batch records the territory `import_generation` used by that batch. All packets in the
batch use that one generation.

PDF download reads packet geometry, topology, addresses, and every accepted Overture, direct FEMA,
and row-gap FEMA building from the recorded generation. It never queries the current territory
generation in place of the recorded one and never contacts Overture or FEMA. Consequently,
importing a newer territory generation does not change the map in an already-finalized batch.

The founder territory receives one complete real-data import that includes persisted buildings
before the open renderer becomes authoritative. Existing finalized batches that predate a recorded
generation continue through an explicit backfill to the generation containing their referenced
segment versions; the migration must not infer a newer generation at download time.

## Pinned basemap style

Commit the exact approved Positron baseline as a repository asset and apply the Streetlight changes
from `docs/PRINT_MAP_RENDERING_GUIDE.md` in one production TypeScript module. Do not fetch an
unversioned style document at render time.

The pinned style continues to reference OpenFreeMap-hosted vector tiles, sprites, and fonts.
Pinning therefore protects Streetlight's layer structure and visual rules, but it does not make the
hosted service available offline.

The module defines the only production rules for:

- background, land, water, building, road, and route colors;
- removal of visual noise and road casings;
- road-class-to-width-family mapping;
- zoom-aware width expressions;
- highway label font, fill, halo, spacing, and zoom sizes;
- unchanged native OpenMapTiles highway-label placement, collision, and spacing;
- one collision-safe fallback for a selected street only when no native label for that street is
  visible after the initial placement pass;
- route layer order;
- bounds and zoom calculation;
- starting pin and starting-house-number presentation; and
- permanent attribution.

It must implement the numeric values and formulas in the rendering guide, including the thicker
minor-road fallback for unknown classes. Screenshot-specific coordinates, road names, zooms,
endpoint offsets, and hard-coded final pixel widths are prohibited.

The color palette has one grayscale-safe hierarchy: highlighted routes remain materially darker
than ordinary roads and buildings, while route names use pure white text with a dark halo. The pin
and starting number remain high contrast in both color and grayscale.

## Shared route and topology rules

The highlighted route uses the same class-and-zoom width expression as the road underneath it.
Both have round joins and round caps, and neither has a casing.

Endpoint classification reuses the normalized adjacency semantics already implemented in
`web/lib/packet-selection.ts`, including exact endpoint and endpoint-to-interior junctions. Do not
create a second incompatible interpretation of the road network.

Only a confirmed `network_continuation` endpoint receives display-only rounded-cap compensation.
The endpoint moves inward by half the final rendered stroke in meters, capped at 49 percent of its
terminal line leg. Selected joins, true network ends such as cul-de-sacs, and ambiguous endpoints
remain unchanged. Derived display geometry exists only in memory; imported and packet geometry is
never rewritten.

Put these style and topology calculations in pure TypeScript functions so the server renderer and
the interactive workspace can consume the same rules. This is shared product logic, not a provider
abstraction.

## Server render flow

`web/app/api/packets/pdf/route.ts` retains its authenticated, church-scoped download behavior. It
opens one controlled headless Chromium browser for the PDF request. For each requested packet it:

1. Load the immutable packet, recorded import generation, complete relevant road graph, persisted
   buildings, and starting position.
2. Build the MapLibre style and GeoJSON sources using the shared rules.
3. Calculate a square viewport from all selected coordinates and the starting display position
   using the guide's 512-pixel Web Mercator world and a 1.20 bounds multiplier.
4. Keep the resulting fractional zoom; do not floor it or use tract-count presets.
5. Open a fresh page containing a non-interactive 1280-by-1280 MapLibre map.
6. Wait for the map's initial `idle` event while listening for map errors and enforcing a render
   timeout.
7. Query visible features in the native highway-name layers. For each selected street name not
   represented, add one fallback line-center label on its longest selected segment with ordinary
   collision and edge avoidance enabled. Compare names case-insensitively after whitespace,
   leading-compass, and common final-suffix normalization.
8. Wait for the fallback placement pass to become idle, or finish immediately when no fallback is
   needed.
9. Capture only the map element as PNG.
10. Embed the PNG in the existing 582-point square in the current PDF layout.
11. Close the page and continue to the next packet.

It closes each page after its packet succeeds or fails and closes the browser after the complete
PDF succeeds or fails. A fresh page per packet prevents WebGL state from leaking between maps. Do
not add a browser pool, worker queue, cache, or standalone render service unless measured production
render time or memory demonstrates that the simple path is inadequate.

## Attribution and production gate

The final attribution line is drawn permanently inside the map image because MapLibre's interactive
attribution control is disabled in the headless page. It must remain legible after embedding and on
paper.

Before enabling production use, review and record the then-current official terms and attribution
requirements for OpenFreeMap, OpenStreetMap/OpenMapTiles, the exact Overture release and themes,
and FEMA USA Structures. The review must explicitly confirm that automated server-side rendering
and printed distribution are permitted. The implementation records the review date and source
links beside the committed attribution copy.

Do not use `tile.openstreetmap.org`. Do not silently change tile hosts. If OpenFreeMap's public
service terms or reliability are unacceptable at that review, stop the migration for a founder
decision rather than adding an unapproved provider.

## Failure behavior

PDF rendering fails visibly and preserves finalized data when any required packet geometry,
recorded import generation, persisted map data, style asset, tile, sprite, font, or MapLibre render
is unavailable.

The API retries a transient map render once. If the retry fails, it returns the existing
`Could not render packet maps` class of error. It does not return a partial PDF and does not render
the packet with Google.

Invalid individual building geometry is rejected and recorded during import, not discovered for
the first time during PDF download. Missing or inconclusive topology leaves ordinary rounded caps;
it never guesses an intersection trim.

OpenFreeMap availability is still required at PDF render time. Overture and FEMA availability is
not, because their accepted polygons are already stored.

## Automated checks

The implementation must leave focused checks proving:

- a U.S. import activates roads, addresses, apartments, Overture buildings, and FEMA fallbacks in
  one generation or activates none of them;
- an outside-coverage import records `overture_only`;
- FEMA fallback rows satisfy and preserve either the direct-match rule or every approved row-gap
  threshold, plus the residential, non-outbuilding, and deduplication rules;
- batch finalization records one import generation;
- repeat download selects the recorded generation after a newer import becomes current;
- pre-migration batches use an explicit matching-generation backfill;
- viewport bounds include every route coordinate and the starting display position at the 1.20
  multiplier;
- short, medium, and long packets select different zooms through the same formula;
- viewport zoom remains fractional and never uses tract-count presets;
- road and route widths use the documented class-and-zoom expressions;
- unknown roads use the minor width family;
- route casings and basemap road casings are absent;
- only `network_continuation` display endpoints move;
- a selected join remains continuous and a cul-de-sac remains untrimmed;
- the selected route stays below the unchanged native OpenMapTiles highway-name layers;
- a selected street with a visible native label gets no fallback, while a missing name is merely
  offered one collision-safe fallback and is never forced to overlap;
- only the starting house number renders, beneath the pin at the deterministic display point;
- no other address labels, guessed buildings, or unresolved-address markers render;
- the output PNG is exactly 1280 by 1280;
- attribution appears in the PNG and remains present in the PDF;
- the existing packet code, address block, tract count, QR payload, logo, page count, and layout
  remain unchanged;
- a map failure returns no partial PDF and changes no finalized data; and
- the PDF route no longer calls Google Roads or Google Static Maps.

The existing repository tests, formatter, TypeScript check, and production build must continue to
pass.

## Human review

Before cutover, the founder:

1. Imports the complete real founder territory with Overture and FEMA available.
2. Finalizes representative short, medium, and long packets.
3. Downloads each batch twice and confirms the maps are unchanged.
4. Compares several maps against the approved prototype and known satellite evidence, paying
   particular attention to previously missing buildings.
5. Checks residential, service, major, and ambiguous roads at multiple zooms.
6. Checks route joins, ordinary intersections, dead ends, and cul-de-sacs.
7. Scans the Google directions QR code.
8. Prints sample pages in color and grayscale and approves street readability, route clarity,
   building coverage, pin and starting number, attribution, and overall page layout.
9. Confirms that the one PDF remains legible in grayscale without a separate black-and-white mode.
10. Reviews the recorded provider terms and attribution decision.

Only after those checks does the open renderer replace Google for production PDF maps.

## Non-goals

This PDF project does not by itself:

- implement the separately approved authenticated-workspace migration;
- build a separate map comparison tool;
- change packet selection or routing;
- show house numbers beyond the starting house;
- create a separate black-and-white or one-bit PDF;
- infer buildings from addresses;
- provide FEMA coverage outside the United States;
- self-host OpenFreeMap;
- add a generic provider or renderer framework;
- add persistent rendered-image storage;
- optimize with tiling, browser pools, queues, or a render service before measurement; or
- change the Google Maps directions QR code.
