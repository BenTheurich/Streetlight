# Map Layers and Import Reuse Design

## Goal

Replace the permanent Map/Satellite pills with a compact Google-style Layers control, and avoid
rerunning the Overture street-and-address import when the saved import already covers the proposed
territory.

## Layers control

- Disable Google's native Map/Satellite control.
- Show one compact **Layers** card above the lower-left Google attribution in every workspace tool.
- The card uses a local decorative aerial-style thumbnail. It must not create a second Google map
  or request a Static Maps image.
- Clicking the card opens a small chooser containing **Map** and **Satellite**.
- The active choice is visibly and accessibly identified. Choosing an option updates the existing
  shared Google map and closes the chooser.
- The chooser closes on Escape, an outside click, or a selection.
- The selected basemap remains unchanged when the administrator switches workspace tools.
- Google attribution remains visible and unobstructed.

## Import-footprint reuse

An Overture import is a square geographic footprint described by its saved center and radius. A
territory save reuses the current streets and addresses whenever the proposed territory's enclosing
square fits completely inside that saved footprint.

An import remains required when:

- the workspace still contains proof data;
- the pinned Overture release, normalizer version, or required quality metadata is outdated;
- no valid imported center or radius exists; or
- any edge of the proposed enclosing square extends beyond the saved import footprint.

The enclosing squares use the same latitude-aware calculation as the Overture import request.
Comparison includes a small numeric tolerance so insignificant floating-point differences cannot
trigger an import.

The following changes do not import while the proposed footprint remains contained:

- exclusion polygon creation, editing, toggling, naming, or deletion;
- hidden-road activation;
- exact-segment exclusion or restoration;
- switching between circle and square;
- decreasing the boundary distance; and
- moving the center while using a sufficiently smaller contained boundary.

Increasing the distance or moving the center imports only when the proposed footprint reaches
geography not already stored. Import completion replaces the saved footprint metadata with the
new center and radius.

## Failure behavior

When an import is required, the existing long-running save state remains. A failed import leaves
the saved territory, streets, addresses, and draft unchanged. Saves that reuse stored data do not
show the import state.

## Verification

Automated checks cover contained and extending footprints, ordinary territory edits, source-data
upgrade requirements, and floating-point tolerance. Browser review confirms:

1. the Layers card opens and closes its chooser;
2. Map and Satellite update the existing map without losing tool state;
3. the control does not cover Google attribution;
4. an exclusion-only save does not show an import;
5. a contained radius reduction does not import; and
6. a boundary expansion beyond the saved footprint does show the import state.

