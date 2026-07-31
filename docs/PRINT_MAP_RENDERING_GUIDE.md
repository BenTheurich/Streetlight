# Streetlight open-data print map rendering guide

Status: implemented on the open-data maps branch; founder and provider-terms review pending

Recorded: 2026-07-30

Prototype baseline: `tmp/map-comparison/render_custom_vector_map.cjs`

## Purpose

This document preserves the exact data combination, cartographic rules, and rendering process that
produced the founder-approved open-data packet map. It is the implementation reference for the
open-data replacement of the Google Static Maps image in Streetlight's printable packet PDFs.

`PRODUCT.md` remains the product authority. The implementation is not ready to deploy until the
visual, print, provider-terms, and founder-review gates below pass.

## What each named project supplies

These names describe different layers of the stack; they are not interchangeable providers.

| Project or dataset | Role in the approved render |
|---|---|
| **MapLibre GL JS** | Renders the vector style, Streetlight overlays, labels, and marker into a browser canvas that can be captured as PNG. |
| **OpenFreeMap** | Hosts the Positron style document, vector tiles, sprites, and fonts used by the prototype. The style URL is `https://tiles.openfreemap.org/styles/positron`. |
| **OpenMapTiles** | Defines the layer names and properties inside the vector tiles, such as `landcover`, `landuse`, road classes, and highway-name layers. |
| **OpenStreetMap** | Supplies the underlying roads, parks, water, and other basemap data distributed through OpenFreeMap. |
| **Overture Maps** | Supplies Streetlight's normalized road geometry, road classes, address points, and the preferred building footprints. The prototype is pinned to release `2026-06-17.0`. |
| **FEMA USA Structures** | Supplies a U.S.-only building polygon when a real address demonstrates that Overture is missing a nearby residential building. It is a narrow fallback, not a replacement building layer. |
| **Streetlight** | Supplies packet selection, the orange route, starting position, viewport, deterministic merge rules, and the custom print style. |

The visual result is therefore:

> OpenFreeMap Positron vector basemap, restyled by Streetlight, with Overture buildings replacing
> the basemap building layer, a small set of address-matched FEMA fallbacks, and the selected
> Streetlight packet drawn on top.

## Binding principles

1. Never invent, estimate, or draw a building merely because an address exists.
2. Overture is the preferred building source.
3. FEMA is used only when an address point confirms an Overture coverage gap and the FEMA feature
   passes the residential checks below.
4. Missing or ambiguous buildings remain missing. Do not show placeholder rectangles or address
   markers on the volunteer map.
5. Streetlight's stored road geometry remains unchanged. Any route-cap adjustment is display-only.
6. Every route stroke uses the same road-class and zoom-width rule as the road underneath it.
7. Map scale is derived from the complete packet bounds. No street-specific or screenshot-specific
   widths, endpoint offsets, or coordinates are allowed.
8. Attribution remains visible in the printed map.

## Required render input

The renderer needs one immutable input object:

```ts
type PrintMapInput = {
  packet: {
    code: string;
    start: { address: string; position: [number, number] };
    segments: Array<{
      id: string;
      streetName: string;
      roadClass: string;
      geometry: GeoJSON.LineString;
    }>;
  };
  networkSegments: Array<{
    id: string;
    streetName: string;
    geometry: GeoJSON.LineString;
  }>;
  overtureBuildings: Array<{
    id: string;
    geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  }>;
  addresses: Array<{
    id: string;
    number: string;
    street: string;
    geometry: GeoJSON.Point;
  }>;
  femaBuildings: Array<{
    id: string;
    geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
    properties: {
      PRIM_OCC?: string;
      OUTBLDG?: boolean | number;
    };
  }>;
};
```

Coordinates are WGS84 `[longitude, latitude]`. `networkSegments` contains the current normalized
road graph for the packet's territory, not only the selected packet segments.

For production, collect and persist the required display polygons during the existing territory
import. Repeated PDF downloads should not depend on a new Overture or FEMA network request and
should reproduce the same map from the same finalized packet data. Do not add a generic map-provider
abstraction; this documented stack is the only proposed implementation.

## Viewport calculation

The approved prototype renders a square `1280 × 1280` PNG, which the current PDF embeds into a
`582 × 582` point square.

1. Gather the starting position and every coordinate from every selected packet segment.
2. Convert them to normalized Web Mercator world coordinates:

   ```text
   x = (longitude + 180) / 360
   y = (1 - asinh(tan(latitudeRadians)) / π) / 2
   ```

3. Find the packet's world-coordinate bounding box.
4. Multiply its width and height by `1.28`. This provides 14% breathing room on each side.
5. Choose the largest integer zoom that fits both padded dimensions:

   ```text
   zoom = floor(log2(min(
     1280 / (256 × paddedWorldWidth),
     1280 / (256 × paddedWorldHeight)
   )))
   ```

6. Clamp the prototype zoom to `0…19`.
7. Center the square viewport on the unpadded packet bounding-box midpoint.
8. Give MapLibre those exact bounds with zero additional padding.

The route length therefore changes the zoom naturally. Every later road, label, and route width
uses that final zoom.

## Building-source merge

### Overture query

The prototype reads Overture GeoParquet directly from the public S3 release:

```text
s3://overturemaps-us-west-2/release/2026-06-17.0/
  theme=buildings/type=building/*
s3://overturemaps-us-west-2/release/2026-06-17.0/
  theme=addresses/type=address/*
```

The DuckDB query uses the feature `bbox` columns to select features intersecting the render bounds.
It retains each building's ID and complete polygon geometry. For addresses it retains ID, house
number, street, and point geometry. Addresses without a house number are not needed for the fallback
test.

### FEMA query

The prototype requests GeoJSON from:

```text
https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/
USA_Structures_View/FeatureServer/0/query
```

It sends the render bounds as a WGS84 envelope and requests:

```text
BUILD_ID, PRIM_OCC, OUTBLDG, SOURCE, PROD_DATE, IMAGE_DATE
```

A production territory import must handle service pagination and record the FEMA feature ID,
source, product date, image date, and retrieval time. FEMA is U.S.-only; outside its coverage,
Streetlight renders Overture buildings alone.

### Deterministic fallback rules

Use a `10 meter` point-to-polygon distance threshold.

For each numbered Overture address:

1. Measure the address point to the nearest Overture building polygon. A point inside a polygon has
   distance zero.
2. If that distance is at most 10 meters, Overture already accounts for the address. Add no FEMA
   feature.
3. Otherwise find the nearest FEMA polygon.
4. Accept it only when all three conditions hold:

   - distance from address point to FEMA polygon is at most 10 meters;
   - `PRIM_OCC === "Single Family Dwelling"`;
   - `OUTBLDG` is not truthy, matching FEMA's use of null for structures that are not marked as
     outbuildings.

5. Deduplicate accepted fallbacks by FEMA `BUILD_ID`.
6. Record the address ID, FEMA building ID, and measured distance as validation provenance.
7. If the checks fail, render nothing for that address. Do not draw a guessed building.

The direct rule can falsely suppress a missing home when its address is within 10 meters of a
neighboring Overture footprint. Apply this second, narrower row-gap rule only to those suppressed
candidates:

1. Reject a FEMA polygon within 5 meters of any Overture footprint or without a numbered Overture
   address within 10 meters.
2. Require `PRIM_OCC === "Single Family Dwelling"` and a non-truthy `OUTBLDG`.
3. Require an Overture footprint on the same side of the named road both before and after the FEMA
   polygon. Each along-road gap must be at most 35 meters and each neighbor's road setback must be
   within 12 meters of the candidate's setback.
4. Require candidate area to be 0.55–2.5 times the local median and compactness to be at least
   0.45. Compute the median from same-side 40–800 square-meter Overture footprints within 100 meters
   and no more than 90 meters along the road tangent.
5. Deduplicate by FEMA `BUILD_ID`, retain the matched address and full FEMA provenance, and reject
   every unresolved candidate.

The founder pilot accepted 11 of 50 addressed row-gap candidates with no observed false positives
and one apparent false negative. These thresholds are the approved deterministic rule, not values
to tune per screenshot or locality. The accepted polygon improves map completeness but does not add
another estimated home because its matched address is already counted.

The approved sample contained 236 Overture building polygons and only 5 accepted FEMA fallbacks.
Those numbers are evidence for that packet, not constants for other territories.

### Building presentation

Remove the original `building` layer from the OpenFreeMap style so base-map buildings do not
conflict with the verified overlay.

Insert one combined GeoJSON building source before the path/road layers:

```text
fill color:         #e6e9ed
fill opacity:       0.98
outline color:      #d2d7dc
```

Overture and accepted FEMA polygons use the same visual treatment. Source identity remains in the
feature properties for validation and attribution.

## Basemap restyle

Start with OpenFreeMap Positron. Do not recreate an entire vector style from scratch.

### Remove visual noise

Remove:

- the original `building` layer;
- layers whose IDs start with `boundary_`;
- layers whose IDs start with `railway`;
- layers whose IDs start with `aeroway`, plus `airport`;
- every symbol layer except `highway-name-minor` and `highway-name-major`.

This intentionally removes business labels, points of interest, neighborhood labels, and other
content that does not help a volunteer follow a paper route.

### Color rules

| Feature | Color | Opacity |
|---|---:|---:|
| Background and residential land use | `#ffffff` | 1 |
| Parks and added grass/park land use | `#d9f2df` | 1 / 0.92 |
| Wood land cover | `#deefe1` | 0.9 |
| Water | `#cfe8f3` | 1 |
| Waterways | `#b9dce9` | style default |
| Paths | `#e2e7eb` | 0.8 |
| Minor, major, and motorway roads | `#bac9d6` | 1 |
| Selected packet route | `#ef6c3c` | 0.96 |

Add two quiet green layers before paths:

- OpenMapTiles `landcover` classes `grass`, `wood`, and `scrub`;
- OpenMapTiles `landuse` classes `park`, `recreation_ground`, and `grass`.

Both use `#d9f2df` at `0.92` opacity.

### Remove road casings

Set the following layers to zero opacity:

```text
highway_major_casing
highway_major_subtle
highway_motorway_casing
highway_motorway_subtle
```

Do not add a separate light or white road outline. Roads are a single cool-gray stroke.

## Zoom-aware road widths

Use one exponential MapLibre interpolation with base `1.4` and zoom stops `14`, `18`, and `20`.

| Width family | Zoom 14 | Zoom 18 | Zoom 20 |
|---|---:|---:|---:|
| Minor/residential | 8 px | 31 px | 42 px |
| Service | 3 px | 12 px | 18 px |
| Track | 2 px | 8 px | 12 px |
| Path | 2 px | 6 px | 8 px |
| Major | 11 px | 39 px | 52 px |
| Motorway | 13 px | 40 px | 52 px |

Between two stops, use MapLibre's exponential interpolation:

```text
t = (1.4^(zoom - lowerZoom) - 1)
    / (1.4^(upperZoom - lowerZoom) - 1)

width = lowerWidth + (upperWidth - lowerWidth) × t
```

OpenMapTiles minor road classes map as follows:

```text
minor   → minor
service → service
track   → track
unknown → minor
```

Streetlight/Overture route classes map as follows:

```text
residential, living_street, unclassified → minor
service                                  → service
track                                    → track
primary, secondary, tertiary, trunk      → major
motorway                                 → motorway
unknown                                  → minor
```

The unknown fallback is deliberately the thicker minor curve. A too-thin printed route is harder
to follow than a slightly thick ambiguous road.

## Route rendering and endpoint treatment

Draw each selected packet segment as its own line feature immediately below the highway-name
layers:

```text
color:       #ef6c3c
opacity:     0.96
line width:  the exact class-and-zoom expression used by the road underneath
line cap:    round
line join:   round
no casing
```

Never use one fixed route width. The orange route must inherit the same width family and zoom
curve as its underlying road.

### Endpoint classification

Classify each selected segment's first and last coordinate using the complete normalized territory
road graph:

1. `selected_join`: another selected packet segment shares the endpoint. Leave the coordinate
   unchanged; rounded lines overlap into one continuous route.
2. `network_continuation`: the selected segment ends, but another non-selected network segment
   connects there. Apply the display-only cap compensation below.
3. `network_end`: nothing else connects there. Leave the coordinate unchanged so a dead end or
   cul-de-sac keeps a full rounded cap.
4. `ambiguous`: topology is unavailable or inconclusive. Leave the coordinate unchanged.

The prototype groups exact endpoints with seven decimal places:

```text
longitude.toFixed(7) + "," + latitude.toFixed(7)
```

The live implementation should reuse Streetlight's existing normalized adjacency semantics in
`web/lib/packet-selection.ts`, including exact endpoints and endpoint-to-interior junctions, rather
than creating a second incompatible road graph.

### Rounded-cap compensation

A round line cap extends half the line width beyond its centerline endpoint. At a confirmed
`network_continuation`, move only the derived display endpoint inward by half the rendered stroke:

```text
metersPerPixel =
  156543.03392804097 × cos(latitudeRadians) / 2^zoom

trimMeters = renderedRouteWidthPixels / 2 × metersPerPixel
```

Move the start coordinate toward its next coordinate, or the end coordinate toward its previous
coordinate, by `trimMeters`. The prototype caps the movement at 49% of that terminal line leg.
The round cap then visually ends at the original source connector instead of spilling halfway into
the intersection.

Do not compensate `selected_join`, `network_end`, or `ambiguous` endpoints. In particular, do not
apply the rule to every terminal; doing so creates visible gaps in cul-de-sacs.

This operation creates render geometry in memory. It must never update
`street_segments.geometry_geojson`, packet geometry, or imported Overture geometry.

## Street labels

Keep only the OpenFreeMap/OpenMapTiles minor and major highway-name layers. They remain above the
orange route so volunteers can read the street name inside the highlighted road.

```text
font:              Noto Sans Bold
text color:        #ffffff
halo color:        #687985
halo width:        1 px
halo blur:         0
symbol spacing:    320
letter spacing:    0.01
text-size stops:   zoom 14 → 12 px, zoom 18 → 17 px, zoom 20 → 19 px
interpolation:     linear
```

Pure white text matters in print. The restrained dark halo supplies contrast without creating the
heavy outlined-text appearance of the original OpenStreetMap style.

## Starting marker and house numbers

The approved custom-vector prototype draws a green pin at the stored packet starting coordinate:

```text
outer green:  #0f7055
white border: 3 px
white center
```

The latest comparison intentionally omitted all house-number labels, including the starting house
number, while the PDF treatment was still being evaluated. The production migration must make one
explicit choice before release:

- draw only the packet's stored starting house number beside the pin; or
- rely on the existing printed `STARTING ADDRESS` block above the map.

Do not restore general address labels. They add clutter and may make an address appear attached to
the wrong footprint.

## Server-side PNG and PDF flow

The smallest production path that preserves the approved result is:

1. Keep the existing `renderPacketPdf` layout in `web/lib/packet-pdf.ts`.
2. Replace only its injected `renderMap(packet)` implementation.
3. Build the customized MapLibre style and GeoJSON sources from stored territory and packet data.
4. Render a non-interactive `1280 × 1280` MapLibre map in a controlled headless Chromium page:

   ```text
   interactive: false
   attributionControl: false
   fadeDuration: 0
   preserveDrawingBuffer: true
   renderWorldCopies: false
   fitBounds padding: 0
   ```

5. Wait for `idle`; fail if MapLibre emits a map error.
6. Capture only the map element as PNG.
7. Embed the PNG through the existing `pdf-lib` flow.
8. Keep the existing Google walking-directions QR code. The QR destination is independent of the
   printed basemap.

The attribution control is disabled only because the print renderer draws a permanent attribution
line itself. Never omit that replacement.

For one small pilot, a fresh headless page per PDF request is acceptable. Add pooling or a separate
render service only if measured render time or memory makes the simple path inadequate.

## Attribution, terms, and production gate

The prototype displays:

```text
OpenFreeMap © OpenMapTiles · Data from OpenStreetMap · Overture Maps · FEMA USA Structures
```

Treat that as prototype copy, not a legal conclusion. Before production:

1. Review the then-current OpenFreeMap terms and confirm server-side automated print rendering is
   permitted.
2. Follow OpenStreetMap's attribution guidelines and ODbL requirements.
3. Generate the Overture attribution required by the exact pinned release and themes. Overture
   buildings and transportation are currently ODbL and may include additional upstream
   attribution.
4. Confirm the USA Structures layer's current service terms and required FEMA/ORNL credit.
5. Put the resulting attribution inside the map image where it remains visible on paper.
6. Record the reviewed terms date and source URLs with the implementation decision.

Official references checked while recording this guide:

- OpenFreeMap: <https://openfreemap.org/>
- OpenFreeMap terms: <https://openfreemap.org/tos/>
- OpenMapTiles schema: <https://openmaptiles.org/schema/>
- OpenStreetMap attribution: <https://www.openstreetmap.org/copyright>
- OpenStreetMap tile policy: <https://operations.osmfoundation.org/policies/tiles/>
- Overture attribution and licensing: <https://docs.overturemaps.org/attribution/>
- MapLibre layer/style reference: <https://maplibre.org/maplibre-style-spec/layers/>
- FEMA USA Structures service used by the prototype:
  <https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/USA_Structures_View/FeatureServer/0>

OpenFreeMap currently permits commercial use and advertises its public instance without API keys
or request limits, but it is provided without an SLA and its terms may change. The production
decision must choose either the public instance with that operational risk or the project's
documented self-hosting path. Do not silently switch tile hosts.

Do not use `tile.openstreetmap.org` for production PDF generation. Its public raster service has a
separate usage policy, prohibits bulk/prefetch patterns, and offers no SLA. It appeared only in an
earlier comparison panel, not in the approved custom-vector result.

## Failure behavior

A packet PDF must fail clearly rather than quietly change geography.

- Missing stored packet geometry: fail the map render.
- OpenFreeMap style, tile, sprite, or font failure: fail the map render.
- Invalid Overture/FEMA geometry: omit the invalid feature, record it, and fail the territory import
  if the remaining data no longer meets the approved completeness checks.
- Missing network topology: render ordinary rounded route caps; do not guess intersection trims.
- Missing FEMA coverage or service: render Overture buildings alone and record that no FEMA fallback
  set was available. A finalized packet must still use its persisted import snapshot.
- MapLibre error or render timeout: return the existing `Could not render packet maps` failure and
  leave finalized packet data unchanged.

Never fall back to Google automatically after the open-data renderer becomes authoritative; an
unannounced provider switch makes repeated downloads non-deterministic and can reintroduce the
printing-license problem.

## Validation contract

The migration is not complete until automated checks prove:

1. Every render is exactly `1280 × 1280`.
2. Bounds contain every selected route coordinate and the starting position.
3. The renderer uses the pinned Overture release recorded by the territory import.
4. Every rendered building is an Overture polygon or an accepted, address-matched FEMA polygon.
5. FEMA fallbacks satisfy the 10-meter, single-family, non-outbuilding rule and are deduplicated.
6. No unresolved-address markers or guessed buildings are drawn.
7. Residential, service, track, major, and motorway routes inherit the corresponding basemap width
   curve at all three zoom anchors.
8. Unknown route classes use the minor/residential curve.
9. Route and basemap width expressions each contain one zoom interpolation rather than a fixed
   screenshot-specific width.
10. Road casings and route casings are absent.
11. Route caps and joins are round.
12. Only confirmed `network_continuation` display endpoints move; stored source coordinates and all
    internal coordinates remain unchanged.
13. A known cul-de-sac fixture remains `network_end` and is not shortened.
14. Label size, white fill, and one-pixel halo match this guide.
15. Attribution is visible in the PNG and remains legible in the final printed PDF.
16. The existing one-page-per-packet PDF, starting-address block, tract count, QR code, logo, and
    packet code remain unchanged.

Also render fixtures at short, medium, and long packet extents. Review the PDFs on paper, not only
on a high-resolution monitor.

## Proven prototype and known limits

The approved Temecula render was generated and checked with:

- a real finalized Streetlight packet and its stored normalized road classes;
- the complete current territory road graph for endpoint classification;
- OpenFreeMap Positron rendered through MapLibre GL JS;
- 236 real Overture building polygons;
- 5 real FEMA USA Structures polygons accepted by the fallback rule;
- zero guessed buildings and zero unresolved-address markers;
- road and route widths driven by class and zoom;
- topology-aware rounded caps;
- a `1280 × 1280` output.

The prototype is not production code. Its current limits are:

- FEMA coverage is U.S.-only.
- OpenFreeMap availability has no SLA.
- The prototype fetches some source data during research rather than persisting it with a territory
  import.
- The latest custom render does not draw the starting house number.
- Legal attribution copy still requires the production review above.
- Only the founder's sample area has received detailed visual comparison against Google.

These limits are explicit migration work, not reasons to change the proven cartographic rules.

## Repository references

- Product authority: `PRODUCT.md`
- Current Google PDF renderer: `web/lib/packet-pdf.ts`
- Existing normalized road adjacency: `web/lib/packet-selection.ts`
- Research design: `docs/superpowers/specs/2026-07-30-real-data-map-comparison-design.md`
- Research plan and evidence: `docs/superpowers/plans/2026-07-30-real-data-map-comparison.md`
- Disposable data extraction and fallback proof:
  `tmp/map-comparison/render_real_map_comparison.py`
- Disposable custom-vector renderer: `tmp/map-comparison/render_custom_vector_map.cjs`
- Executable style contract: `tmp/map-comparison/test_custom_vector_style.cjs`

The `tmp/map-comparison` files and generated images are disposable and may be removed. This guide
is the durable record of the approved result.
