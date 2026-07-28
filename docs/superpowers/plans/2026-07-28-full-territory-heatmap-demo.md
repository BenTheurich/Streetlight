# Full-territory Heatmap Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development and execute this plan inline. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show coherent, varied outreach ages across the real imported territory without changing canonical church history, and shorten the legend to age ranges.

**Architecture:** Keep classification unchanged. Update only legend copy, then let the existing isolated demo command copy the canonical database and add deterministic age bands based on each active segment's distance from the church.

**Tech Stack:** Node.js, TypeScript, SQLite, Next.js

## Global Constraints

- Never write fake coverage events to `web/data/streetlight.db`.
- The demo target must remain named `coverage-demo.db` and display `Demo data`.
- Use 30-, 120-, 240-, and 500-day completion ages; leave the far edge never covered.
- Keep the existing configurable heatmap thresholds and fixed color meaning.
- Add no dependencies or product scope.

---

### Task 1: Range-only legend

**Files:**
- Modify: `web/lib/coverage.test.ts`
- Modify: `web/lib/coverage.ts`
- Modify: `web/db/database.test.mjs`
- Modify: `docs/superpowers/specs/2026-07-28-editable-heatmap-and-database-recovery-design.md`

- [x] Change the existing literal legend expectations to `0-89 days`, `90-179 days`, `180-364 days`, `365+ days or never`, and `Excluded`, including the custom-threshold equivalents.
- [x] Run the focused Node tests and confirm the expectations fail because production labels still contain color names.
- [x] Remove only the four color-name prefixes in `coverageLegend`.
- [x] Run the focused Node tests and confirm the legend behavior passes.
- [x] Update the older approved design's legend examples to reflect the founder's newer decision.

### Task 2: Full-territory isolated demo

**Files:**
- Modify: `web/db/database.test.mjs`
- Modify: `web/db/seed-coverage-demo.mjs`
- Modify: `README.md`

- [x] Add a database test that copies a controlled source into `coverage-demo.db`, proves the source is unchanged, and proves the demo has all four coverage classes plus never-covered segments.
- [x] Run the focused database test and confirm it fails because the demo seeder cannot copy a source territory.
- [x] Add an optional source database argument. When present, copy it to the guarded demo target, require an empty source coverage history, and assign active residential segments into distance-ranked 30/120/240/500-day bands with the farthest band left uncovered.
- [x] Make `pnpm coverage:demo` use `web/data/streetlight.db` as its source while keeping explicit test targets deterministic.
- [x] Update the README's demo description.
- [x] Run the complete test, lint, typecheck, and build commands.
- [x] Start the isolated demo and inspect the map and legend in a real browser.
