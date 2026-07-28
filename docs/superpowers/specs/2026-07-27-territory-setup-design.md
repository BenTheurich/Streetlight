# Streetlight Phase 2 territory setup design

Status: awaiting founder review of amended written specification
Designed: July 27, 2026
Amended: July 27, 2026
Product authority: [PRODUCT.md](../../../PRODUCT.md)
Execution roadmap: [IMPLEMENTATION_PLAN.md](../../../IMPLEMENTATION_PLAN.md)

Amended again July 28, 2026 by
[the hidden-road activation design](2026-07-28-hidden-road-activation-design.md). That amendment
supersedes this document where it introduces the retained hidden-road pool, its visibility toggle,
administrator activation, and activation persistence. Radius, exclusion, draft/save, and
non-editable geometry rules remain in force.

## Purpose

Phase 2 creates and maintains one church outreach territory. It is a separate, rarely used
administration page. It must not be combined with the everyday coverage heatmap.

The territory begins as a circle around the church. The administrator adjusts its radius and
draws polygons over places that should not receive outreach packets.

## Approved approach

Streetlight uses **radius minus exclusions**:

1. Resolve the church address to a geographic point.
2. Draw a circular territory from that point and a radius.
3. Automatically import Overture street and address data when the saved location requires a
   new footprint.
4. Normalize that source data into deterministic, read-only outreach segments.
5. Exclude any segment that is not entirely inside the radius.
6. Exclude any whole segment whose road line touches or crosses an exclusion polygon.

The outer territory is not a freeform polygon. Administrators do not manually edit imported
street geometry or estimated tract counts.

`Excluded area` is the setup-page label for the product's existing `ignore zone` concept.
They are one stored object, not separate features.

## Page separation

Territory Setup and the Coverage Dashboard are separate pages with different color meanings.

- **Territory Setup:** segments use the page accent color when eligible and gray when excluded.
- **Coverage Dashboard:** segments use red, orange, yellow, and green to communicate coverage
  age.

The Territory Setup header includes a clear action back to the Coverage Dashboard.

## Normal page layout

The page has two permanent regions:

- A large interactive Google map on the left.
- A narrow, persistent setup sidebar on the right.

The Google Maps JavaScript API supplies the base map, normal pan and zoom behavior, street
labels, buildings, and landmarks. Streetlight draws its radius, segment lines, exclusion
polygons, and church marker above that map.

### Map

The normal map state shows:

- The circular radius as a dashed accent-color line.
- Every active imported segment.
- Eligible segments as solid, semi-transparent accent-color lines.
- Excluded segments as solid, semi-transparent gray lines.
- Hidden candidate roads as thin, semi-transparent blue-gray lines only when `Show hidden roads`
  is enabled.
- Saved and draft exclusion polygons as translucent red shapes.
- A small legend whose solid orange and gray samples match the map.
- `Pan` and `Draw exclusion` modes.
- Standard map zoom behavior.

There is no visibility toggle for active segments. Their eligibility remains visible throughout
setup so the administrator can understand the effect of radius and polygon changes. The
July 28 amendment adds a separate `Show hidden roads` toggle for candidate activation.

Segment strokes scale with the Google map zoom instead of retaining one fixed pixel width.
They are approximately 2 pixels when zoomed out and rise gradually to a maximum of 5 pixels
when close. Their transparency keeps Google road names readable through the overlay.

### Sidebar

The sidebar contains:

1. The current church address with an explicit `Change` action.
2. A radius slider and synchronized numeric mileage field.
3. Live eligible-tract and eligible-segment totals.
4. A `Draw exclusion area` action.
5. A list of exclusion polygons and their affected-segment counts.
6. Persistent `Cancel` and `Save changes` actions at the bottom.

The initial pilot radius is 10 miles. The first UI supports a 1-to-20-mile slider, while the
numeric input allows the same range precisely.

## Church address behavior

The address is displayed rather than exposed as an always-editable field. Choosing `Change`
opens a focused address form and requires confirmation because changing the address recenters
the territory.

After a valid address is selected:

- The church point moves to the resolved coordinates.
- The radius circle recenters immediately.
- Existing exclusion polygons remain at their geographic coordinates.
- Existing loaded segments preview against the new draft point.
- The page states that street data will refresh when the draft is saved.

If the address cannot be resolved, the existing church point remains unchanged.

## Radius behavior

The slider and numeric field represent one radius value.

- Dragging the slider updates the numeric value and map immediately.
- Typing a valid number updates the slider and map immediately.
- A segment is eligible by radius only when its complete line lies inside or on the circle.
- Segments that cross the circle boundary or lie outside it turn gray.
- Live map and total changes are draft-only until `Save changes`.
- Expanding beyond the loaded import footprint marks the draft as requiring a data refresh.
- Reducing the radius within the loaded footprint does not require another import.

## Exclusion drawing

Streetlight provides one polygon tool. It does not provide rectangle, brush, or freehand
tools.

Drawing works as follows:

1. Choose `Draw exclusion area`.
2. Click points around the unwanted area.
3. The first point immediately appears as a native editable Google vertex handle.
4. The first and second points remain draggable while the partial line is drawn.
5. After three points, `Finish polygon` becomes available.
6. Each affected segment turns gray as the polygon changes.
7. The sidebar previews affected segment and tract counts.
8. The administrator can undo the last point, drag existing points, finish, or cancel.

The map uses a crosshair cursor while adding points. Hovering or dragging an existing vertex
uses Google's native move/hand cursor.

A polygon cannot finish with fewer than three distinct points or when its boundary
self-intersects.

Finishing creates a draft exclusion named `Excluded area N`. The name is optional and can be
changed without reopening the drawing tool.

## Editing exclusions

Selecting a polygon on the map or in the sidebar enters editing mode.

- Every polygon vertex becomes a draggable handle.
- Eligibility and totals update while a handle moves.
- The administrator can rename or delete the polygon.
- `Done editing` returns to normal map mode without persisting the page.
- A deleted polygon remains recoverable through page-level `Cancel` until changes are saved.

Any contact between a segment line and an exclusion polygon excludes the entire segment. This
deliberately favors avoiding unsuitable areas. Live preview lets the administrator adjust a
polygon that touches an unintended segment.

## Draft and persistence model

The browser holds a complete territory draft containing:

- Church address and geographic point.
- Radius.
- Exclusion polygon identifiers, optional names, and coordinates.
- Draft administrator road activations.

Map overlays and totals derive from the draft. Imported road geometry and home estimates remain
non-editable.

`Save changes` submits the complete draft to the server. If the saved center changes, the
radius exceeds the loaded footprint, or the database still contains the proof-only Phase 0
fixture, that same action automatically starts a potentially long-running Overture import.
Exclusion-only saves and radius reductions within the loaded footprint reuse the current
dataset.

During an import, the page disables editing and displays `Importing streets and addresses…`.
The first release keeps the save request open rather than adding a background-job queue,
percentage estimates, or resumable job infrastructure.

The server downloads, normalizes, and validates the replacement dataset before opening the
database transaction. It then replaces the imported segments and saves the territory and
exclusions atomically. Either the complete imported territory persists or none of it does.

`Cancel` discards the draft and restores the last saved territory. Leaving the page with
unsaved changes warns the administrator before navigation.

## Overture import and road eligibility

Google remains the display and submitted-address geocoding provider. Streetlight's durable
street geometry and estimated tract counts come from pinned Overture release `2026-06-17.0`.
Changing that release requires an explicit import-version change rather than silently following
the latest dataset. The importer downloads transportation segments and address points for the
bounding box enclosing the requested circle, retaining complete source lines that touch that
box so boundary eligibility can be calculated correctly. DuckDB reads Overture's public S3
bucket anonymously with the `us-west-2` region set explicitly; ambient AWS credentials are not
used and no Overture API key is required.

Overture road `class` describes road kind and network hierarchy rather than proving whether
homes exist along that road. Streetlight uses the founder-approved
residential-or-address-evidence rule to decide automatic activation:

- Always retain named `residential` and `living_street` road segments.
- Retain named `primary`, `secondary`, `tertiary`, and `unclassified` road segments only when
  at least one matching imported address point is assigned to that normalized segment.
- Retain all other Overture `road` features as hidden candidates.
- Do not retain transportation features whose Overture subtype is not `road`, including paths,
  footways, cycleways, tracks, pedestrian ways, steps, and bridleways.

Address points are assigned deterministically to the nearest normalized segment with the same
canonical street name within 40 meters. The resulting count remains an estimate. Imported
geometries and counts have no administrator correction controls.

The database records the Overture release, import center, imported radius, and successful
completion time. The current 55-segment Phase 0 fixture is marked proof-only and cannot satisfy
any saved territory footprint; the first save automatically replaces it.

## Data and component boundaries

The smallest useful implementation has these responsibilities:

- **Territory page:** loads the saved workspace and owns the draft/save/cancel lifecycle.
- **Interactive map:** owns the Google map instance, overlays, map modes, and pointer events.
- **Setup sidebar:** edits address, radius, polygon metadata, and page actions.
- **Overture importer:** downloads one required footprint, groups all Overture roads, and applies
  the deterministic residential-or-address-evidence rule for automatic activation.
- **Geometry functions:** determine radius containment, polygon intersection, validity, and
  eligible totals.
- **Territory endpoint:** validates the complete draft, conditionally runs the importer, and
  performs the atomic replacement and save.

The stored territory needs a center point and radius. Each exclusion needs a church ID,
territory ID, optional name, and polygon geometry. Import metadata records the source release
and loaded footprint. Imported segments retain source identity, geometry, road class, and
estimated home counts without editable copies. They also retain active/hidden source state and
persistent administrator activation.

No provider abstraction, generalized GIS editor, or compatibility layer is required.

## Google Maps configuration

The interactive map uses the Google Maps JavaScript API. Its browser key must be restricted to
the required API and approved HTTP referrers. Server-side address resolution must not expose a
server credential to the browser.

The implementation must continue to build and run automated checks without live Google
credentials. Missing local credentials may show a clear unavailable-map state, but must not
silently replace the approved production provider.

Google currently documents a 10,000-load monthly free usage cap for Dynamic Maps and
pay-as-you-go billing after the cap:

- [Maps JavaScript API usage and billing](https://developers.google.com/maps/documentation/javascript/usage-and-billing)
- [Google Maps Platform pricing](https://developers.google.com/maps/billing-and-pricing/pricing)

## Failure handling

- Fewer than three polygon points: keep `Finish polygon` disabled.
- Self-intersecting polygon: explain the invalid shape and keep the draft editable.
- Invalid radius: show an inline field error and do not send the draft.
- Unresolved address: preserve the current location and explain the failure.
- Overture download or normalization failure: preserve the prior saved territory and imported
  segments, preserve the full browser draft, and allow retry.
- Save rejection or network failure: preserve the full browser draft and allow retry.
- Database failure: roll back the complete transaction.
- Unsaved navigation: confirm before discarding the draft.

## Accessibility and input

- All sidebar controls have labels and keyboard focus states.
- Included and excluded states have labeled legend samples and sufficiently different color
  and luminance; the legend matches the solid map strokes.
- Map modes have visible selected states and instructions.
- Polygon vertices have sufficiently large mouse and touch targets.
- The Google map retains its standard keyboard pan and zoom controls.
- In drawing mode, a focused map can add a point at its center with `Enter`. In editing mode,
  polygon vertices are keyboard-focusable and arrow keys move the focused vertex.
- Drawing, undo, finish, cancel, rename, delete, save, and page cancellation do not depend on
  unlabeled icons.

## Automated verification

Use the approved Phase 0 fixture and a small synthetic geometry set.

- The proof-only fixture always requires a real import.
- A center change or radius expansion beyond the loaded footprint requires an import.
- Exclusion-only changes and radius reductions within the footprint do not import.
- The residential-or-address-evidence rule retains and rejects every approved road-class case.
- A failed download, normalization, or database write preserves the previous complete dataset.
- A successful import atomically replaces segments and records its source release and footprint.
- All imported segments belong to the pilot church and territory.
- A segment entirely inside the radius is eligible.
- A segment outside or crossing the radius is excluded.
- A segment touched or crossed by an exclusion polygon is entirely excluded.
- An unrelated segment remains eligible.
- Draft totals equal the eligible segment totals after every radius or polygon change.
- Invalid and self-intersecting polygons are rejected.
- Segment stroke width produces the approved zoom-dependent 2-to-5-pixel range.
- Creating, renaming, reshaping, and deleting polygons persist after save and reload.
- Cancelling writes nothing and restores the saved territory.
- A save is atomic.
- Address changes preserve existing polygon coordinates.
- Imported geometry and home counts have no update endpoint or setup control.

## Browser verification

With real local Google credentials:

1. Open Territory Setup and pan and zoom the map.
2. Confirm segment strokes become thinner when zooming out, remain semi-transparent, and do
   not conceal road names.
3. Confirm the legend uses the same solid orange and gray strokes as the map.
4. Drag the radius slider and verify the circle, segment colors, and totals update live.
5. Type a radius and verify the slider and map match.
6. Cancel and verify the saved radius returns.
7. Start an exclusion and verify the first point is immediately visible.
8. Confirm the map uses a crosshair for new points and a move/hand cursor on draggable points.
9. Draw a polygon and verify touched segments turn gray before finishing.
10. Undo a point, finish the polygon, optionally name it, and reshape it.
11. Save a footprint requiring import and wait for the Overture import to finish.
12. Verify the complete imported neighborhood appears and totals reflect the replacement data.
13. Save and reload; verify the same radius, polygon, segment colors, and totals return.
14. Delete the polygon, cancel, and verify it returns.
15. Change the address, confirm, and verify polygons stay at their geographic coordinates.
16. Confirm the browser console has no application errors.

## Phase 2 verification evidence

Verified July 27, 2026 against pinned Overture release `2026-06-17.0` and the pilot address
`31087 Nicolas Rd, Temecula, CA 92591`:

- The first real 1-mile website import completed at
  `2026-07-27T20:20:53.002209+00:00` with 687 imported segments and 3,368 estimated homes.
  The circle contained 487 eligible segments and 2,635 eligible homes before exclusions.
- A saved three-point exclusion removed 19 segments and 102 homes without changing that import
  timestamp. Restarting the dev server returned the same saved radius, polygon, imported set,
  and totals.
- With an invalid `STREETLIGHT_PYTHON`, a 1.1-mile expansion failed in 64 ms, retained the
  complete browser draft, and left the saved 1-mile radius, exclusion, 687 segments, 3,368
  homes, and import timestamp unchanged after reload.
- Restoring the valid executable and saving 1.1 miles reimported 769 segments and 3,880 homes
  at `2026-07-27T20:30:01.764126+00:00`. Reducing the saved radius back to 1 mile completed in
  24 ms without another import and retained that larger imported footprint and timestamp.
- Real Chrome checks passed for broad and close zoom readability, solid semi-transparent orange
  and gray segment styles, matching legend strokes, zoom-scaled line weight, immediate first
  point display, one- and two-point dragging, crosshair and native point cursors, self-crossing
  rejection, live gray exclusion previews, and fixed polygon coordinates after an address
  change. No application console errors occurred; Chrome reported only extension
  message-channel closure noise.
- Reimport retires earlier segment versions and keeps their coverage and finalized-packet
  references intact. The public import ID stays stable while a generation-qualified internal
  row ID versions each current set; workspace and summary reads filter to current rows.
- Keyboard-focusable sidebar vertex buttons use arrow keys to reshape both unfinished drawings
  and selected saved exclusions through the live eligibility callbacks. Unfinished drawing
  points participate in the unsaved-navigation warning.
- `pnpm check` passed Biome lint, TypeScript, 38 Node tests, 16 Python tests, and the Next.js
  production build. `git diff --check` passed.

## Explicit non-goals

Phase 2 does not include:

- The coverage heatmap.
- Packet generation or packet maps.
- Arbitrary outer-boundary drawing.
- Rectangle, brush, or freehand exclusion tools.
- Manual street-geometry correction.
- Manual tract-estimate correction.
- Autosave.
- Importing on every slider movement.
- A background-job queue, percentage progress, or resumable imports.
- Multiple territories.
- Deployment or authentication.

## Completion condition

The founder can open the separate Territory Setup page, understand current eligibility,
adjust the live radius, draw or reshape exclusion polygons, explicitly save, reload, and see
the same territory without editing the database.
