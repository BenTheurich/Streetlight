# Streetlight Phase 2 territory setup design

Status: awaiting founder review of written specification
Designed: July 27, 2026
Product authority: [PRODUCT.md](../../../PRODUCT.md)
Execution roadmap: [IMPLEMENTATION_PLAN.md](../../../IMPLEMENTATION_PLAN.md)

## Purpose

Phase 2 creates and maintains one church outreach territory. It is a separate, rarely used
administration page. It must not be combined with the everyday coverage heatmap.

The territory begins as a circle around the church. The administrator adjusts its radius and
draws polygons over places that should not receive outreach packets.

## Approved approach

Streetlight uses **radius minus exclusions**:

1. Resolve the church address to a geographic point.
2. Draw a circular territory from that point and a radius.
3. Import and display the approved Phase 0 street segments.
4. Exclude any segment that is not entirely inside the radius.
5. Exclude any whole segment whose road line touches or crosses an exclusion polygon.

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
- Every imported segment.
- Eligible segments in the page accent color.
- Excluded segments in gray.
- Saved and draft exclusion polygons as translucent red shapes.
- A small legend for included and excluded segments.
- `Pan` and `Draw exclusion` modes.
- Standard map zoom behavior.

There is no segment-visibility toggle. Segment eligibility remains visible throughout setup so
the administrator can understand the effect of radius and polygon changes.

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
- Segment eligibility and totals recalculate.

If the address cannot be resolved, the existing church point remains unchanged.

## Radius behavior

The slider and numeric field represent one radius value.

- Dragging the slider updates the numeric value and map immediately.
- Typing a valid number updates the slider and map immediately.
- A segment is eligible by radius only when its complete line lies inside or on the circle.
- Segments that cross the circle boundary or lie outside it turn gray.
- Live map and total changes are draft-only until `Save changes`.

## Exclusion drawing

Streetlight provides one polygon tool. It does not provide rectangle, brush, or freehand
tools.

Drawing works as follows:

1. Choose `Draw exclusion area`.
2. Click points around the unwanted area.
3. After three points, `Finish polygon` becomes available.
4. Each affected segment turns gray as the polygon changes.
5. The sidebar previews affected segment and tract counts.
6. The administrator can undo the last point, drag existing points, finish, or cancel.

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

Map overlays and totals derive from the draft. The imported street data remains read-only.

`Save changes` submits the complete draft to the server. The server validates and stores the
territory and exclusions in one database transaction. Either all changes persist or none do.

`Cancel` discards the draft and restores the last saved territory. Leaving the page with
unsaved changes warns the administrator before navigation.

## Data and component boundaries

The smallest useful implementation has these responsibilities:

- **Territory page:** loads the saved workspace and owns the draft/save/cancel lifecycle.
- **Interactive map:** owns the Google map instance, overlays, map modes, and pointer events.
- **Setup sidebar:** edits address, radius, polygon metadata, and page actions.
- **Geometry functions:** determine radius containment, polygon intersection, validity, and
  eligible totals.
- **Territory endpoint:** validates the complete draft and performs the atomic write.

The stored territory needs a center point and radius. Each exclusion needs a church ID,
territory ID, optional name, and polygon geometry. Imported segments retain their Phase 0
geometry and estimated home counts without editable copies.

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
- Save rejection or network failure: preserve the full browser draft and allow retry.
- Database failure: roll back the complete transaction.
- Unsaved navigation: confirm before discarding the draft.

## Accessibility and input

- All sidebar controls have labels and keyboard focus states.
- Included and excluded states differ by text/legend and line style as well as color.
- Map modes have visible selected states and instructions.
- Polygon vertices have sufficiently large mouse and touch targets.
- The Google map retains its standard keyboard pan and zoom controls.
- In drawing mode, a focused map can add a point at its center with `Enter`. In editing mode,
  polygon vertices are keyboard-focusable and arrow keys move the focused vertex.
- Drawing, undo, finish, cancel, rename, delete, save, and page cancellation do not depend on
  unlabeled icons.

## Automated verification

Use the approved Phase 0 fixture and a small synthetic geometry set.

- All imported segments belong to the pilot church and territory.
- A segment entirely inside the radius is eligible.
- A segment outside or crossing the radius is excluded.
- A segment touched or crossed by an exclusion polygon is entirely excluded.
- An unrelated segment remains eligible.
- Draft totals equal the eligible segment totals after every radius or polygon change.
- Invalid and self-intersecting polygons are rejected.
- Creating, renaming, reshaping, and deleting polygons persist after save and reload.
- Cancelling writes nothing and restores the saved territory.
- A save is atomic.
- Address changes preserve existing polygon coordinates.
- Imported geometry and home counts have no update endpoint or setup control.

## Browser verification

With real local Google credentials:

1. Open Territory Setup and pan and zoom the map.
2. Drag the radius slider and verify the circle, segment colors, and totals update live.
3. Type a radius and verify the slider and map match.
4. Cancel and verify the saved radius returns.
5. Draw a polygon and verify touched segments turn gray before finishing.
6. Undo a point, finish the polygon, optionally name it, and reshape it.
7. Save and reload; verify the same radius, polygon, segment colors, and totals return.
8. Delete the polygon, cancel, and verify it returns.
9. Change the address, confirm, and verify polygons stay at their geographic coordinates.
10. Confirm the browser console has no application errors.

## Explicit non-goals

Phase 2 does not include:

- The coverage heatmap.
- Packet generation or packet maps.
- Arbitrary outer-boundary drawing.
- Rectangle, brush, or freehand exclusion tools.
- Manual street-geometry correction.
- Manual tract-estimate correction.
- Autosave.
- Multiple territories.
- Deployment or authentication.

## Completion condition

The founder can open the separate Territory Setup page, understand current eligibility,
adjust the live radius, draw or reshape exclusion polygons, explicitly save, reload, and see
the same territory without editing the database.
