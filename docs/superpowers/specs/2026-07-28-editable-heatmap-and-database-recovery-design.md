# Editable heatmap thresholds and local database recovery

**Date:** 2026-07-28  
**Status:** Founder-approved design  
**Authority:** `PRODUCT.md` remains authoritative

## Purpose

The Coverage page must use the complete saved Phase 2 territory and explain its colors as outreach
ages, not as bare color names. An administrator may change when segments transition from green to
yellow, yellow to orange, and orange to red without changing the meaning or order of the colors.

This amendment also repairs the local review environment. The apparent missing-street regression
came from reviewing Phase 3 against an isolated 55-segment demo database while the completed Phase
2 Overture import remained intact in its former worktree.

## Chosen heatmap model

Store three transition days on each territory:

- `coverage_yellow_after_days`, default `90`
- `coverage_orange_after_days`, default `180`
- `coverage_red_after_days`, default `365`

For an effective last-outreach age in whole calendar days:

- Green: `0` through one day before the yellow transition
- Yellow: yellow transition through one day before the orange transition
- Orange: orange transition through one day before the red transition
- Red: red transition and older, plus every never-covered segment
- Gray: inside the chosen boundary but excluded

The values must be whole numbers, at least `1`, no greater than `3650`, and strictly ascending.
The colors and their order are fixed. The selected 30/90/180/365-day summary period remains
independent of these heatmap settings.

Three transition values are used instead of four independent ranges because independent ranges can
overlap or leave gaps. Presets alone were rejected because they would not give the administrator
the approved control.

## Coverage interface

Add a compact `Heatmap ranges` section to the existing Coverage sidebar with three native number
inputs:

- `Yellow starts at`
- `Orange starts at`
- `Red starts at`

Each input is expressed in days. An explicit `Save ranges` action validates and persists all three
values together. Invalid values do not mutate stored settings and produce a nearby accessible
error. A successful save refreshes the current workspace so the map and legend recolor together.

The legend derives its labels from the saved transitions. With the defaults it reads:

- `0-89 days`
- `90-179 days`
- `180-364 days`
- `365+ days or never`
- `Excluded`

No custom colors, presets, reset system, live unsaved preview, or separate settings page is added.

## Persistence and server boundary

A migration adds the three non-null transition columns to `territories` with the defaults above
and database checks for their range and ordering.

Coverage classification accepts the saved transition values rather than module-level constants.
The Coverage workspace includes those values and computed legend ranges. A focused Coverage API
update accepts exactly the three transition fields, validates them at the trust boundary, writes
them in one transaction for the pilot territory, and returns the refreshed workspace.

Existing correction behavior and coverage events are unchanged.

## Local database recovery

The complete Phase 2 Overture database is the recovery source. Before replacing anything, create
ignored, timestamped SQLite backups of both the stale canonical database and the recovery source.
Then:

1. Copy the Phase 2 database to `web/data/streetlight.db` in the main checkout.
2. Apply every current migration, including the heatmap-settings migration.
3. Verify that the imported release, boundary, exclusions, segment activation decisions, address
   counts, segment counts, and home assignments match the recovery source.
4. Start the main application against that canonical database and inspect both Coverage and
   Territory Setup.

The recovery must not rerun Overture import or alter eligibility decisions. Active roads inside the
saved boundary appear on Coverage; in-boundary exclusions remain gray; hidden candidates and
out-of-boundary roads remain omitted. An administrator can continue activating hidden Overture
geometry from Territory Setup.

Worktree and demo databases remain isolated so automated review cannot mutate the founder's local
data. When the application is intentionally running against `coverage-demo.db`, the interface
shows a visible `Demo data` label. Normal human review runs from the main checkout and canonical
database.

## Verification

Automated checks must prove:

- Default and custom transitions classify their exact boundary days correctly.
- Never-covered remains red under every valid setting.
- Invalid, unordered, extra-key, and out-of-range updates do not mutate the database.
- Saved transitions survive reload and drive both map classes and legend labels.
- Summary-period totals do not change when heatmap transitions change.
- The demo label appears only for the isolated demo database.

The recovery check records literal source and destination counts before and after migration and
fails if any imported territory data or administrator decision changes.

Browser review must confirm that the canonical Coverage page shows the expected saved streets,
the legend explains actual outreach ages, valid range changes persist and recolor the map, invalid
changes are rejected, and Territory Setup still exposes hidden-road activation and saved
exclusions.

## Scope boundaries

This amendment does not change Overture classification, add arbitrary road drawing, expose custom
colors, alter the selected-period metric, merge demo data, or make worktrees share one writable
database.
