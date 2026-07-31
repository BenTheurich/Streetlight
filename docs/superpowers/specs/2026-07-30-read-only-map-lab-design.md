# Founder-only read-only Map Lab

Status: founder-approved design; pilot building and label strategies finalized

Approved: 2026-07-30

Production migration direction approved: 2026-07-31

Depends on: [`Open-data packet PDF maps`](2026-07-30-open-data-packet-pdf-design.md)

Rendering reference: [`docs/PRINT_MAP_RENDERING_GUIDE.md`](../../PRINT_MAP_RENDERING_GUIDE.md)

## Purpose

Give the founder a safe place to compare Streetlight's current Google map with the approved
open-data cartography on a complete real church territory. The lab determines whether the
open-data map is visually clear and responsive enough to replace Google in the authenticated
workspace later.

The lab is an evaluation surface, not a production map migration. It is private, read-only,
separate from the normal workspace, and removable without rolling back any production behavior.

## Founder-approved production direction

The lab established the target architecture for a later, separately requested migration of the
authenticated workspace:

- **Map** uses MapLibre with the approved OpenFreeMap/OpenMapTiles style, OpenStreetMap geography,
  persisted Overture/FEMA buildings, and Streetlight's existing interactive overlays.
- **Satellite** uses the Google Maps JavaScript API in labeled `hybrid` mode. It does not reproduce
  satellite mode by placing raw Google Map Tiles API imagery beneath MapLibre labels.
- The initial Map view does not load Google Maps JavaScript. The application initializes Google
  only after the user first selects Satellite.
- After that first selection, the Google map remains mounted while hidden so later Map/Satellite
  toggles reuse the same instance instead of creating another billable map load.
- Both renderers share the same center and Google-equivalent zoom. A toggle transfers the latest
  camera before revealing the destination renderer.
- Both modes show the same current coverage segments, apartment markers, territory boundary, and
  applicable workspace interaction state. Switching providers must not change application data.
- Packet PDFs continue using only the approved open-data renderer. Satellite imagery is never
  printed.

The Open pane's raw-tile satellite implementation below remains useful only as Map Lab evidence.
Do not copy its tile endpoint, session flow, or OpenFreeMap label overlay into the production
workspace migration. Do not add a generic map-provider abstraction; reuse the two existing map
compositions and the lab's shared-camera conversion.

This split keeps the no-cost open renderer as the default while retaining Google's smoother,
better-labeled satellite experience only when requested. Keeping the lazily created Google map
alive also prevents ordinary toggling from repeatedly initializing billable Dynamic Maps loads.

## Scope and access

Add one route, `/map-lab`, protected by the existing founder-account check and the normal
church-scoped session resolution. A signed-out request follows the existing authentication flow.
An authenticated non-founder receives `404`, not a page that advertises the lab's existence.

The lab reads the founder's currently selected church. It exposes no church selector of its own and
cannot bypass the existing organization-to-church mapping.

The normal administrator workspace, navigation, Google map, editing tools, and data mutations
remain unchanged. The experiment is opened directly at `/map-lab`; it adds no normal workspace
navigation item.

## Three viewing modes

The page has one compact mode control:

- **Open map** mounts only the MapLibre map.
- **Google map** mounts only the same Google map composition used in the production workspace.
- **Compare** mounts both maps side by side.

Only the selected engine loads in the single-map modes. Open-map mode must not load the Google Maps
JavaScript API or Google satellite tiles. Google-map mode must not load OpenFreeMap resources or
the building GeoJSON. Compare mode intentionally loads both and is for visual comparison, not
performance measurement.

Switching modes preserves one shared center and Google-equivalent zoom. MapLibre converts that
shared zoom to its 512-pixel world convention at the engine boundary. Compare mode synchronizes
both values in both directions. Programmatic camera updates carry a short-lived synchronization
guard so they do not trigger an update loop.

No swipe divider, opacity blend, linked cursor, screenshot exporter, or saved comparison is
included.

## Google pane

The Google pane uses the actual production `AdminMap` and `CoverageMap` behavior rather than a
facsimile. It displays the current territory, the existing read-only coverage segments, and
apartment markers using the same data and styling administrators see today.

All edit controls and normal workspace sidebars are omitted. The pane retains the existing
Map/Satellite control; its Satellite choice uses Google's labeled hybrid rendering so street names
remain visible.

The lab must not change the production Google components merely to make comparison easier. If a
small read-only prop is required to suppress editing UI, it must default to current production
behavior.

## Open pane

The Open pane uses MapLibre GL JS and the pinned PDF basemap's presentation, labels, colors, and
layer order. It extends the road-width curves below the packet renderer's first zoom stop so roads
taper naturally in territory-scale views, without changing the approved print widths. Building
footprints begin at Google-equivalent zoom 17. The interactive coverage overlay uses the production
map's zoom-aware 2–5-pixel stroke scale instead of the thicker print-route widths. The pane reads
the current church's persisted building generation and the 11 founder-approved pilot FEMA row-gap
fallbacks described below. Approved fallbacks use the same neutral building style as Overture;
rejected candidates are not sent to the browser.

The pane overlays:

- current normalized street segments with the same coverage-age colors as the production map;
- real retained house numbers at their imported address-point coordinates beginning at
  Google-equivalent zoom 19, with collision avoidance. Center an Overture label when exactly one
  address lies inside exactly one displayed footprint, or when the nearest footprint is within 10
  meters and at least 3 meters closer than the runner-up. For a remaining label, treat addresses
  with the same normalized street and numeric parity as one road-side row; a row of at least three
  addresses may use its nearest footprint within 10 meters only when no other address in that row
  claims the footprint. The global one-address-per-footprint guard still applies. Center a FEMA
  fallback's uniquely matched address using the fallback's persisted address-to-structure
  distance; for an approved row-gap fallback, use its explicit accepted address association.
  Preserve the imported address position for multi-address, overlapping, unmatched, or otherwise
  ambiguous cases;
- apartment markers with the same current status information; and
- the current territory boundary needed to understand coverage.

It does not expose territory editing, ignore-zone editing, packet proposal selection, batch
actions, reconciliation, or any other write path.

The first lab version sends the complete current territory and its buildings as ordinary
church-scoped JSON/GeoJSON. MapLibre performs the client-side drawing. Do not build a vector-tile
pipeline before this real payload is measured. If the founder territory is unacceptably slow or
large, the diagnostics from this experiment become evidence for a separate tiling design.

## Open-pane satellite mode

The Open pane has its own **Map/Satellite** control:

- **Map** shows the approved pinned OpenFreeMap style with persisted Overture/FEMA building fills.
- **Satellite** keeps MapLibre and Streetlight overlays but replaces the vector basemap with Google
  satellite raster tiles.

Satellite tiles are requested through a founder-authenticated, read-only Streetlight endpoint that
uses the Google Map Tiles API session flow. The server-side Google credential is never returned to
the browser. The endpoint and its Google session are not touched until the founder explicitly
selects Satellite.

In satellite mode:

- hide Overture/FEMA building fills because the imagery already depicts roofs;
- keep coverage lines, apartment markers, and the territory boundary;
- keep the OpenFreeMap major and minor street-name layers above the imagery;
- keep Google attribution visible as required; and
- restore the same camera when switching back to Map.

A satellite failure affects only the Open pane's satellite layer. It displays an inline error and
allows an immediate return to Map. It does not switch providers automatically or affect the
Google pane.

Satellite is an experiment for the interactive lab only. It is not used in packet PDFs.

## Read-only data endpoint

Add one founder-only, church-scoped read endpoint for the Open pane. It returns:

- church and territory identifiers needed by the page;
- current territory bounds;
- current normalized street segment IDs, geometry, road class, street name, and coverage state;
- numbered address points assigned to current street segments, containing only the house number
  and coordinate needed for display;
- current apartment coordinates and review/coverage state;
- current persisted map buildings with source metadata, plus only the founder-approved pilot FEMA
  row-gap fallbacks while this remains a lab;
- current import generation and Overture release; and
- attribution metadata needed by the displayed layers.

The endpoint uses the same server-side church scoping as production workspace queries. It accepts
no church ID that can override the session and has no POST, PUT, PATCH, or DELETE counterpart.

The payload does not include resident names, volunteer information, unit identifiers, or data
outside the selected church.

### Final FEMA building strategy

Overture remains the preferred footprint source. The existing direct FEMA fallback accepts a real
Single Family Dwelling not marked as an outbuilding when a numbered Overture address is within 10
meters of the FEMA polygon and no Overture footprint is within 10 meters of that address. It
deduplicates by FEMA building ID and retains the matched address, measured distance, source dates,
and retrieval provenance.

The pilot revealed a narrow false-suppression case: an address can be within 10 meters of a
neighboring Overture house while its own footprint is missing. For those candidates, first reject
any FEMA polygon within 5 meters of an Overture footprint or without a numbered Overture address
within 10 meters. Then accept only a FEMA Single Family Dwelling that is not an outbuilding and has
an Overture footprint on the same side of its named road both before and after it. Each along-road
gap must be no larger than 35 meters, each neighbor's road setback must be within 12 meters of the
candidate, the candidate area must be 0.55–2.5 times the local median, and compactness must be at
least 0.45. The local comparison uses same-side 40–800 square-meter Overture footprints within 100
meters and 90 meters along the road tangent.

That deterministic rule accepted 11 of the 50 addressed pilot candidates. Founder review found no
clear false positives and one apparent false negative. The lab now renders those 11 exactly like
ordinary FEMA fallbacks and centers each associated house number on its footprint. The other 39
candidates and all unaddressed FEMA-only structures are omitted entirely.

The pinned JSON is immutable evidence for this exact pilot generation, not the production import
mechanism. A later production importer must recompute the same rule from pinned source releases,
persist complete FEMA provenance, and then supply the accepted polygons to both the interactive map
and packet renderer. Because each accepted polygon already has an address, it improves display
completeness without adding another house to counts. Map Lab itself remains read-only and does not
write `map_buildings`, packet data, or PDF generations.

## Diagnostics

Each mounted pane displays a small diagnostics block for the current session:

- time from mount to map ready;
- Streetlight data bytes downloaded by that pane;
- street, apartment, Overture building, and FEMA fallback counts;
- current center and zoom; and
- current load or render error.

Diagnostics are held in page memory and disappear on navigation or refresh. There is no analytics
service, persistent telemetry, FPS graph, request history, benchmark database, or alerting.

Single-map mode is the performance evaluation. Compare mode's timing is labelled as a double-map
load and is not used to judge whether either engine is independently fast enough.

## Loading and failure behavior

The page reserves the map area while its selected pane loads and shows a plain loading state.
Errors are pane-local:

- failure of the OpenFreeMap style, tiles, sprites, fonts, or building payload leaves the Open pane
  in an error state;
- failure of Google Maps leaves only the Google pane in an error state;
- failure of Google satellite tiles leaves the Open vector Map option available; and
- one failed pane in Compare mode does not unmount the other.

The page does not retry forever, silently substitute a provider, or mutate territory/import state
to repair a display failure. A manual retry remounts only the failed pane.

## Automated checks

The implementation must leave focused checks proving:

- signed-out access follows the existing authentication behavior;
- an ordinary authenticated administrator receives `404`;
- the founder sees only the selected church's data;
- the read endpoint rejects cross-church identifiers and supports no mutations;
- Open-map mode does not load Google Maps JavaScript or request Google satellite resources;
- Google-map mode does not request OpenFreeMap resources or the building payload;
- Compare mode mounts both panes and preserves one camera when switching modes;
- bidirectional camera synchronization does not loop;
- the Google pane uses current production coverage and apartment presentation;
- the Open pane preserves the pinned PDF widths at packet zooms, adds tapered interactive widths
  below those zooms, delays buildings until Google-equivalent zoom 17, and uses the production
  map's interactive zoom-aware coverage stroke scale;
- the Open pane displays persisted Overture/FEMA buildings plus the 11 accepted pilot row gaps as
  ordinary buildings, sends no unresolved candidates to the client, and changes no production
  counts or persistence;
- Open Map shows real numbered address points only from Google-equivalent zoom 19 and Open
  Satellite does not duplicate Google's address labels. A unique one-address Overture footprint,
  a nearest Overture footprint within 10 meters that wins by at least 3 meters, a uniquely claimed
  nearest footprint in a three-address same-street/parity row, a uniquely identified persisted FEMA
  fallback, and an explicitly associated approved row-gap fallback center their labels, while
  multi-address and ambiguous cases retain their imported coordinates;
- Google satellite requests begin only after explicit selection;
- satellite modes keep street names visible; the Open pane hides building fills but keeps
  Streetlight overlays and required attribution;
- pane errors remain isolated;
- diagnostics remain in memory and write nothing; and
- normal production workspace routes and behavior remain unchanged.

The existing repository tests, formatter, TypeScript check, and production build must continue to
pass.

## Human review

The founder evaluates the lab separately from the PDF migration:

1. Open each single-map mode on desktop and a supported tablet width.
2. Pan and zoom through dense neighborhoods, parks, major roads, service roads, dead ends, and
   known Overture/FEMA coverage gaps.
3. Compare street-label readability, road hierarchy, coverage-line alignment, apartment markers,
   building completeness, house-number placement, and general visual calm against Google.
4. Enter Compare mode at several zoom levels and confirm both cameras remain synchronized.
5. Switch both panes between Map and Satellite and confirm street names remain visible while the
   camera and Streetlight overlays remain stable.
6. Review ready time, payload size, feature counts, browser console errors, and subjective
   pan/zoom responsiveness in single-map mode.
7. Confirm ordinary workspace editing and Google behavior are unchanged.

The founder approved the production direction recorded above on 2026-07-31. Applying it to the
authenticated workspace remains a separate implementation request; this lab does not make that
change itself.

## Acceptance boundary

The lab succeeds when it truthfully renders the complete founder territory in both engines,
provides an isolated satellite experiment, exposes useful session diagnostics, and gives the
founder enough evidence to decide whether a later interactive migration deserves its own design.

It is not required to outperform Google, and it does not automatically change production based on
its results.

## Non-goals

The Map Lab does not:

- replace or toggle the map inside the production workspace;
- support ordinary administrators;
- write territory, segment, packet, apartment, or coverage data;
- reproduce every production editing tool;
- migrate packet PDF rendering, which is the preceding project;
- build a generic map-provider abstraction;
- build vector tiles or a map data service before payload measurement;
- infer house numbers or move an address label when the nearest building is ambiguous;
- persist diagnostics or add analytics;
- cache or prefetch Google satellite tiles;
- use satellite imagery in printed packets; or
- perform the separately approved production workspace migration.
