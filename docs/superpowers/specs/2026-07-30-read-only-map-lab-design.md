# Founder-only read-only Map Lab

Status: founder-approved design

Approved: 2026-07-30

Depends on: [`Open-data packet PDF maps`](2026-07-30-open-data-packet-pdf-design.md)

Rendering reference: [`docs/PRINT_MAP_RENDERING_GUIDE.md`](../../PRINT_MAP_RENDERING_GUIDE.md)

## Purpose

Give the founder a safe place to compare Streetlight's current Google map with the approved
open-data cartography on a complete real church territory. The lab determines whether the
open-data map is visually clear and responsive enough to replace Google in the authenticated
workspace later.

The lab is an evaluation surface, not a production map migration. It is private, read-only,
separate from the normal workspace, and removable without rolling back any production behavior.

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

All edit controls and normal workspace sidebars are omitted. The pane may retain Google's native
Map/Satellite control because it is part of the production baseline being evaluated.

The lab must not change the production Google components merely to make comparison easier. If a
small read-only prop is required to suppress editing UI, it must default to current production
behavior.

## Open pane

The Open pane uses MapLibre GL JS and the pinned PDF basemap style, building presentation, labels,
colors, and layer order. Its interactive coverage overlay uses the production map's zoom-aware
2–5-pixel stroke scale instead of the thicker print-route widths. It reads the current church's
persisted Overture and accepted FEMA building generation.

The pane overlays:

- current normalized street segments with the same coverage-age colors as the production map;
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
- current apartment coordinates and review/coverage state;
- current persisted map buildings with source metadata;
- current import generation and Overture release; and
- attribution metadata needed by the displayed layers.

The endpoint uses the same server-side church scoping as production workspace queries. It accepts
no church ID that can override the session and has no POST, PUT, PATCH, or DELETE counterpart.

The payload does not include resident names, volunteer information, unit identifiers, or data
outside the selected church.

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
- the Open pane uses the pinned PDF basemap style while its coverage overlay uses the production
  map's interactive zoom-aware stroke scale;
- the Open pane displays persisted Overture and accepted FEMA buildings from the current
  generation;
- Google satellite requests begin only after explicit selection;
- satellite mode hides building fills but keeps Streetlight overlays and required attribution;
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
   building completeness, and general visual calm against Google.
4. Enter Compare mode at several zoom levels and confirm both cameras remain synchronized.
5. Switch the Open pane between Map and Satellite and confirm the camera and Streetlight overlays
   remain stable.
6. Review ready time, payload size, feature counts, browser console errors, and subjective
   pan/zoom responsiveness in single-map mode.
7. Confirm ordinary workspace editing and Google behavior are unchanged.

The founder then makes a separate product decision: keep Google in the workspace, revise the
experiment, or design a production interactive-map migration. Approval of the packet PDF renderer
does not imply approval of the interactive map.

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
- persist diagnostics or add analytics;
- cache or prefetch Google satellite tiles;
- use satellite imagery in printed packets; or
- create a permanent product feature before the founder approves a later migration.
