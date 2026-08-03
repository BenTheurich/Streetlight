# Exact-segment territory selection

Status: founder-approved design

## Decision

Setup will replace polygon-based excluded areas with direct exact-segment selection. Polygon
drawing, editing, naming, enabling, disabling, and persistence will be removed. Existing polygon
data is demo-only and does not require migration.

Hidden-road activation will also operate on exact selected segments rather than complete connected
roads.

## Interaction

- Clicking a segment replaces the current selection with that segment.
- Shift-clicking adds or removes individual segments.
- Shift-dragging draws a temporary rectangle and adds every intersecting segment.
- A visible **Select area** map control arms the same rectangle gesture for one drag on touch
  devices, then returns to normal map panning.
- Clicking empty map space, pressing Escape, or choosing **Clear selection** clears the selection.
- Hidden segments participate only while **Show hidden roads** is enabled.

Normal dragging continues to pan the map. There is no persistent Pan/Edit mode and no polygon
instruction overlay.

## Feedback and actions

Selected segments keep their included, excluded, or hidden stroke and receive the shared light-blue
selection halo. The temporary rectangle uses a quiet translucent selection-blue treatment.

A compact selection tray appears as soon as at least one segment is selected. It shows selected
segment and estimated-tract totals, followed only by applicable actions:

- **Exclude included**
- **Restore excluded**
- **Activate hidden**
- **Clear selection**

Mixed selections may expose more than one status-specific action, with the affected count in each
label. Applying an action keeps the segments selected so the result is visible and reversible
before the administrator saves.

## Sidebar and accessibility

The polygon list and editor are removed. The current single-road inspector becomes a compact
selected-roads summary. A searchable road picker can add an exact segment to the same selection for
administrators who cannot use pointer gestures. Selection controls remain keyboard-operable, have
visible focus, and announce updated counts and draft actions.

The existing territory-wide Save and Cancel model remains authoritative. Selection changes affect
only the draft until Save succeeds.

## Data and removal scope

Territory drafts persist exact activated-segment and excluded-segment identifiers. Polygon fields,
geometry helpers used only by exclusion editing, polygon map sources and layers, vertex controls,
and polygon demo fixtures are removed. No compatibility layer or migration is added for demo data.

## Acceptance criteria

- A mouse user can select one segment, refine a selection, or box-select several without leaving
  normal map navigation.
- A touch or keyboard user has an explicit alternative to Shift-drag.
- Included, excluded, and revealed hidden segments can coexist in one selection and expose only
  valid actions.
- Activation affects only the exact hidden segments selected.
- Selection never hides the underlying segment status.
- Cancel restores the saved territory; Save persists exact segment actions.
- Map/satellite switching preserves the current selection and annotation state.