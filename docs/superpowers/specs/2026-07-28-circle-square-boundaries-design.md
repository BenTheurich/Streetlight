# Streetlight Phase 2 circle and square boundaries design

Status: approved founder design
Approved: July 28, 2026

## Purpose

Overture data is queried through a latitude-aware bounding box that encloses the requested circle.
Territory Setup should let an administrator use either that complete square footprint or the
inscribed circle without treating the unused corners as administrator exclusions.

## Approved interaction

Territory Setup adds a `Boundary shape` control with `Circle` and `Square` choices. The existing
radius control becomes `Boundary distance`.

- In circle mode, the distance is the circle radius.
- In square mode, the same distance produces the exact bounding box calculated by the existing
  Overture import.

Changing the shape or distance updates the map and totals immediately as part of the current
draft. `Save changes` persists both values, and `Cancel` restores the saved values.

Existing exclusion polygons remain at their geographic coordinates when the boundary changes.
Switching shapes does not delete imported roads, hidden-road activations, exact-segment
exclusions, or exclusion polygons.

## Import footprint

The Overture importer continues making one bounding-box query derived from the church point and
boundary distance. It normalizes road geometry and assigns residential addresses throughout that
complete box rather than discarding addresses outside the circle.

The imported distance describes the reusable square footprint. Switching between circle and
square at the same or a smaller distance does not start another import. Moving the church point,
increasing the distance beyond the loaded footprint, changing the pinned Overture release, or
changing the normalizer version retains the existing import rules.

Existing pilot data requires one reimport under the new normalizer because its outside-circle
address evidence was previously discarded. A failed reimport leaves the saved territory and
previous import intact.

## Boundary and map rules

A segment belongs to the selected boundary only when its complete geometry is inside that circle
or square. Streetlight does not clip a crossing segment at the boundary.

Segments outside the selected boundary are not rendered and do not contribute to totals. This
applies to automatic roads, hidden Overture candidates, polygon exclusions, and exact-segment
overrides. An administrator decision outside the current boundary remains stored and becomes
visible again if a later boundary includes it.

Within the selected boundary:

- Eligible active segments use the page accent color.
- Segments affected by an enabled exclusion polygon or exact-segment override are gray.
- Hidden Overture candidates appear only while `Show hidden roads` is enabled.
- A disabled exclusion polygon remains a faint editable outline and does not affect eligibility.

Gray therefore always means inside the chosen boundary but excluded. It never means outside the
outer boundary.

## Persistence and data flow

The territory draft and saved territory store `boundaryShape` as `circle` or `square`, with
existing records defaulting to `circle`. The saved boundary geometry matches the selected shape
and distance.

The server validates the shape at the API boundary. Client and server eligibility derivation use
the same whole-segment containment rule so previews, persisted totals, and packet eligibility
cannot disagree.

No new map provider, geographic provider, dependency, or background import path is added.

## Acceptance criteria

Automated verification must prove:

- The existing distance calculation produces the same enclosing Overture bounding box.
- Residential addresses in the bounding-box corners are assigned to imported segments.
- Circle mode omits every segment outside the circle from rendering and totals.
- Square mode includes eligible corner segments and their home counts.
- A boundary-crossing segment remains outside instead of being clipped.
- Every gray segment is inside the selected boundary.
- Shape changes persist after Save and revert with Cancel.
- Switching shape within the loaded footprint does not request another import.
- Import failure preserves the last saved territory and import.

Browser verification must confirm:

- The shape control updates the boundary outline, visible segments, and totals immediately.
- Circle mode removes the corner segments rather than drawing them gray.
- Square mode restores eligible corner segments with credible tract counts.
- Hidden-road, polygon, and exact-segment interactions still work inside either boundary.
- Save, reload, and Cancel preserve the approved draft behavior.

## Scope boundaries

This amendment does not add freeform outer boundaries, rotated squares, rectangles, clipped street
geometry, multiple territories, additional provider queries, or separate imports for each shape.
