# Streetlight Phase 2 exact-segment exclusions design

Status: approved founder design
Approved: July 28, 2026

## Purpose

Drawing a polygon around one unsuitable street segment is needlessly tedious. Territory Setup
therefore supports a reversible exclusion override for one exact Streetlight segment while
preserving imported Overture geometry.

## Approved interaction

On Territory Setup, clicking an eligible orange segment selects only that highlighted segment.
The sidebar identifies the street, shows its estimated tracts, and offers `Exclude segment`.

Excluding the segment updates the live draft immediately. The segment turns gray, stops
contributing to eligible-segment and tract totals, and remains visible and selectable. Selecting
a manually excluded segment offers `Restore segment`.

Restoring removes only the manual segment override. It does not override an enabled exclusion
polygon or the territory radius, so a restored segment may remain gray for one of those reasons.

Selecting a segment, hidden-road candidate, or exclusion polygon clears the other selection. The
existing `Save changes` action persists segment overrides, and `Cancel` restores their last saved
state.

No confirmation is required because the action is reversible and remains unsaved until the
administrator saves the territory draft.

## Persistence and eligibility

A segment exclusion is stored against the exact imported segment identity. It affects only that
short Streetlight segment, even when adjacent segments share its street name or road group.

Ordinary reimports preserve the exclusion while that exact imported segment still exists. If the
segment disappears or is replaced by materially different geometry, the replacement does not
inherit the exclusion.

An excluded segment keeps its source geometry, name, estimate, and activation state. The override
only makes it ineligible for totals and packet generation. Restoring the segment removes the
override without recreating or reimporting source data.

## Map behavior

- Eligible active segments use the existing orange treatment.
- The selected segment uses a stronger highlight without obscuring the street name.
- Manually excluded segments use the existing gray excluded treatment and remain clickable.
- Segments excluded only by radius or polygon do not offer `Restore segment`.
- Hidden Overture roads retain their separate activation interaction.

## Acceptance criteria

Automated verification must prove:

- Excluding one segment leaves adjacent segments on the same named road unchanged.
- A manual segment exclusion removes only that segment and its tracts from live totals.
- Restoring removes only the manual override.
- Radius and polygon exclusions still apply after a manual override is restored.
- Save and reload preserve exact-segment exclusions.
- Cancel restores the last saved segment exclusions.
- A matching segment retains its override through an ordinary reimport.
- Changed or replacement geometry does not inherit an old segment exclusion.

Browser verification must confirm:

- An orange segment can be selected without entering another map mode.
- The sidebar clearly identifies the selected segment and exposes `Exclude segment`.
- Excluding turns the segment gray and updates totals before Save.
- A manually excluded gray segment remains selectable and exposes `Restore segment`.
- Segment, hidden-road, and polygon selections do not compete.
- Save, reload, and Cancel behave as designed.

## Scope boundaries

This amendment does not delete imported road data, exclude an entire named road, draw replacement
geometry, edit home estimates, add bulk actions, or create a separate excluded-segment list.
