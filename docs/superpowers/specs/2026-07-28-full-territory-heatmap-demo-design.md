# Full-territory heatmap demo

Approved July 28, 2026.

## Goal

Show the Phase 3 heatmap across the real imported territory with enough varied outreach history to review the colors and legend visually.

## Decisions

- Keep fake outreach history out of `web/data/streetlight.db`.
- Use the isolated `web/data/coverage-demo.db`, copied from the current full imported territory.
- Assign deterministic geographic bands around the church so the map reads coherently rather than looking randomly colored:
  - inner area: completed 30 days ago (green)
  - next band: completed 120 days ago (yellow)
  - next band: completed 240 days ago (orange)
  - outer band: completed 500 days ago (red)
  - far edge: never completed (red)
- Keep the existing `Demo data` indicator while the isolated database is active.
- The legend shows only the configured age ranges beside their color swatches:
  - `0–89 days`
  - `90–179 days`
  - `180–364 days`
  - `365+ days or never`
  - `Excluded`

This is disposable review data, not church outreach history.
