# Phase 3 Coverage History and Heatmap Design

**Date:** 2026-07-27
**Status:** Approved implementation default under the founder's autonomous Phase 3 delegation
**Authority:** `PRODUCT.md` remains authoritative

## Purpose

Phase 3 turns the saved outreach territory into the main administrator dashboard. It records
immutable segment-coverage history, derives each segment's current last-covered date, and colors
the map so the oldest work is immediately visible.

The founder explicitly approved moving past Phase 2 in the July 27 message that said Phase 2 was
working great and directed autonomous Phase 3 implementation. The completeness amendment passes
its full local contract and repository checks. Its external version-2 Overture refresh remains
deferred because the network sandbox requires a new current authorization for the exact stored
coordinates, but Phase 3 consumes the unchanged stable segment contract and does not depend on that
provider call.

This phase does not generate packets or reconcile batches. Those remain Phases 4–6. In particular,
the dashboard does not add a second manual way to mark arbitrary streets completed; Phase 3
provides the append-only write model for later reconciliation and correction controls for existing
completion records.

## Chosen approach

Use the existing `coverage_events` table as an event ledger and derive the current view. A completed
event is never updated or deleted. A correction row points to the original completed event and
either supplies a replacement date or voids that completion.

Alternatives considered:

1. **Mutable `last_covered` on each segment:** smallest query, but loses the history explicitly
   required by `PRODUCT.md`.
2. **Append-only ledger with a derived view (chosen):** preserves history and needs only one small
   pure derivation function.
3. **Periodic coverage snapshots:** useful for analytics at much larger scale, but unnecessary for
   the first church and outside the first release.

The initial implementation loads one church's modest event set and derives it in TypeScript. This
is intentionally simple. A material performance problem at multi-church scale would justify moving
the same semantics into a SQL view.

## Event semantics

`coverage_events` keeps its existing `completed` and `correction` kinds. Migration 010 adds an
`is_void` flag plus append-only and correction-target integrity triggers.

- A `completed` row has a date, does not correct another event, and is not void.
- A `correction` row always points directly to a `completed` root for the same church and physical
  segment row.
- A non-void correction replaces that root's effective date.
- A void correction repeats the date being voided in the table's existing non-null `covered_on`
  column, sets `is_void`, and removes that root from the current last-covered calculation.
- The latest correction by SQLite insertion order wins. A later dated correction can restore a
  previously voided completion.
- Updates and deletes are rejected by the database.

Insert triggers also reject a church/segment ownership mismatch, completed rows with correction
fields, corrections without a root, and corrections targeting another church, physical segment,
or correction row. The `is_void` column has a strict zero-or-one check.

All coverage values are real `YYYY-MM-DD` calendar dates. Future dates are rejected at the server
boundary. Dates are interpreted at UTC midnight for age calculations so the same saved value
produces the same result in every browser time zone. The current calendar date comes from the
pilot church's `America/Los_Angeles` time zone.

When street data is reimported, history follows the stable logical `import_segment_id`. Events keep
referencing their immutable physical segment version; the dashboard joins old and current versions
through that logical identifier.

## Heatmap defaults

These thresholds are implementation defaults, as allowed by `PRODUCT.md`:

| Class | Current age | Initial stroke |
|---|---|---|
| Green | 0–89 days | `#3E8B65` |
| Yellow | 90–179 days | `#D2A128` |
| Orange | 180–364 days | `#D66B2D` |
| Red | 365+ days or never covered | `#B4473D` |
| Gray | Inside the saved boundary but excluded | `#77736C` |

The four coverage strokes remain translucent enough to read Google road labels. Stroke width uses
the Phase 2 zoom-sensitive helper. Clicking a colored segment selects it; a native segment select
provides the equivalent keyboard-accessible control.

## Dashboard

The root route becomes the Coverage dashboard. Territory Setup stays separate at `/territory`.

The page reuses the accepted full-height map-and-sidebar shell:

- **Map:** active segments inside the saved boundary, colored by effective coverage age; excluded
  segments remain gray and selectable; selected segment receives a stronger stroke; a compact
  legend defines the colors. Hidden and out-of-boundary segments are omitted.
- **Sidebar header:** `Coverage` and the saved territory name.
- **Header navigation:** an accessible `Territory setup` link back to `/territory`.
- **Summary:** total eligible tracts, estimated homes covered in the selected period, active packet
  count.
- **Period control:** native select for 30, 90, 180, or 365 days; 90 days is the default. It changes
  only the period metric, not heatmap thresholds.
- **Segment control:** native select of every visible segment, including gray exclusions, plus map
  selection.
- **Selected segment:** street name, estimated tracts, current last-outreach date or `Never`, and
  its append-only history.
- **Correction controls:** every completed root is a separate entry identified by its stable event
  ID, effective state, and correction history. Each root has its own native date input and
  `Undo completion` action. An undone root can be restored by saving a date. Correcting an older
  root never changes a newer root.

The interface uses `outreach` and `tracts`. It does not add charts, volunteer statistics, manual
street/home corrections, reporting, packet controls, or AI.

## Dashboard metrics

- **Total tracts:** sum of estimated homes for currently eligible segments.
- **Estimated homes covered:** sum each currently eligible logical segment's estimated homes once
  when its effective last-covered date falls within the selected inclusive period. A 90-day period
  is the UTC interval `[asOf - 89 days, asOf]`. Repeated effective completions do not multiply this
  progress measure.
- **Active packets:** current count of packets with status `active`. Zero is a valid value before
  packet phases are implemented.

## Server boundary

The server exposes one focused correction endpoint:

```text
POST /api/coverage
{ "eventId": "...", "coveredOn": "2026-07-27" }
{ "eventId": "...", "coveredOn": null }
```

A date appends a replacement correction; `null` appends a void correction. The server chooses the
church, validates the target root and date, writes one row in an immediate transaction, and returns
the refreshed coverage workspace. Unknown, cross-church, correction-of-correction, malformed, and
future requests fail without mutation.

The database module also exposes the completed-event insert used by tests and future reconciliation,
but Phase 3 does not expose it as a dashboard action. Exact-key request validation rejects
`segmentId`, `kind: "completed"`, and every other attempt to create a completion through HTTP.

## Representative review data

Normal `db:seed` must not insert fake outreach into the founder's real local database. A separate,
explicit coverage-demo seed creates an ignored `web/data/coverage-demo.db` with representative
green, yellow, orange, red, never, corrected, and voided histories plus one active packet. The demo
command deletes and recreates only that exact generated demo file before seeding relative dates,
then launches Next directly with `STREETLIGHT_DATABASE_PATH`; it never runs the normal `pnpm dev`
prelude against the founder database.

## Verification

Automated checks prove:

- fixed events derive the expected last-covered dates and all four classes;
- never-covered is red;
- correction and void rows change the current view while preserving roots;
- malformed/future dates and invalid correction targets do not mutate data;
- database update/delete attempts fail;
- history follows a logical segment across reimport;
- eligible tract, selected-period tract, and active-packet totals match literal fixtures;
- the explicit demo seed is isolated and idempotent.

The final human review opens the isolated demo dashboard, sees every color, changes the metric
period, selects streets from both map and native control, changes a completion date, undoes one,
reloads, and confirms the heatmap communicates newest versus oldest without instructions.
If Codex cannot access localhost with the permitted browser controller, the browser check is
recorded as unrun and Phase 3 remains `Awaiting human review`; server checks cannot be presented as
a substitute.
