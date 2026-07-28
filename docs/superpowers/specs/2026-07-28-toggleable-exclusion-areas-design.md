# Streetlight Phase 2 toggleable exclusion areas design

Status: approved founder design
Approved: July 28, 2026

## Purpose

An administrator may want to suspend an exclusion area temporarily without losing its carefully
drawn boundary. The current editor also hides deletion until an area is selected, making that
existing action difficult to discover.

This amendment makes both actions explicit while preserving the territory editor's existing
whole-draft Save and Cancel model.

## Approved interaction

Every exclusion-area row has three visible controls:

- A checkbox that is checked when the exclusion is enabled.
- The name and impact summary, which selects the polygon for renaming or reshaping.
- A `Delete` button.

Unchecking an area updates the live draft immediately. Its affected roads return to eligibility
and the territory totals update, but the polygon, name, and geometry remain stored in the draft.
The disabled row says `Off` and reports how many segments it would exclude if enabled instead of
claiming that those segments are currently excluded.

Enabled polygons retain the existing red treatment. Disabled polygons remain visible as faint
gray outlines without a fill. They stay selectable and editable. A selected disabled polygon uses
a stronger gray outline so its edit handles remain understandable.

Deleting asks for a simple confirmation because recreating a polygon is tedious. Confirming
removes the area from the draft. The existing `Save changes` action persists checkbox and deletion
changes; `Cancel` restores the last saved exclusions, enabled states, names, and geometry.

The decorative three-dot mark is removed. This amendment does not introduce an overflow menu or a
second editing mode.

## Persistence and eligibility

Each exclusion area stores one boolean `enabled` value. Existing rows migrate as enabled.

Only enabled exclusion polygons participate in segment intersection, eligibility, tract totals,
and packet generation. Disabled polygons remain ordinary church-owned exclusion records and are
returned with the territory workspace so the editor can display and re-enable them.

The existing whole-draft territory request remains the only persistence path. No new endpoint,
soft-delete state, audit log, or generalized status model is added. A saved deletion removes the
record; disabling is the reversible alternative when the administrator wants to preserve it.

## Failure behavior

Validation rejects a missing or non-boolean enabled value at the request boundary. The database
accepts only enabled or disabled values. As with the existing territory save, any failed write
rolls back the complete draft and preserves the previously saved state.

## Acceptance criteria

Automated verification must prove:

- Existing exclusion rows become enabled after migration.
- Only enabled exclusions remove segments and tracts from eligibility.
- Toggling an exclusion updates the live draft without changing its geometry.
- Saving and reloading preserves the enabled state.
- Cancelling a toggle or deletion restores the saved state.
- Saving a deletion removes only the selected exclusion.
- Invalid enabled values and failed saves preserve the complete prior draft.

Browser verification must confirm:

- Every row exposes an understandable checkbox and visible Delete action.
- An enabled polygon is red and affects roads and totals.
- A disabled polygon is a faint gray outline, remains selectable and editable, and does not affect
  roads or totals.
- The disabled row describes potential rather than current impact.
- Delete confirmation, Save, reload, and Cancel behave as designed.

## Scope boundaries

This amendment does not add exclusion scheduling, date ranges, opacity controls, bulk actions,
undo history, or road-level deactivation.
