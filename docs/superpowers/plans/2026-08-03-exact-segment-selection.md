# Exact-segment Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan inline in the current session.

**Goal:** Replace polygon exclusions and whole-road hidden activation with a fast, exact-segment multi-selection workflow in Setup.

**Architecture:** Keep the existing territory draft and Save/Cancel model, but make activated and excluded segment IDs the only persisted road adjustments. Reuse the shared MapLibre segment source and selection halo; add direct multi-selection and a temporary box-selection gesture without introducing a persistent editor mode.

**Tech Stack:** React 19, TypeScript, MapLibre GL, existing Streetlight components and Node tests.

## Global constraints

- No polygon compatibility layer or demo-data migration.
- Activation and exclusion affect exact selected segments only.
- Underlying included, excluded, and hidden styling remains visible beneath selection.
- Hidden segments participate only when **Show hidden roads** is enabled.
- Preserve the existing territory-wide Save and Cancel workflow.
- Add no dependency or new map renderer.

---

### Task 1: Simplify the territory data model

**Primary files:** `web/lib/territory-draft.ts`, `web/lib/territory-client.ts`, `web/lib/database.ts`, and their existing territory/database tests.

- [ ] Remove polygon exclusions from draft parsing, derived territory state, persistence, and demo fixtures.
- [ ] Replace activated road-group identifiers with activated segment identifiers.
- [ ] Keep excluded segment identifiers as the single exclusion mechanism.
- [ ] Update focused tests for exact hidden activation, exclusion/restoration, Save/Cancel, and rejected malformed input.

### Task 2: Replace polygon editing with direct multi-selection

**Primary files:** `web/components/TerritoryEditor.tsx`, `web/components/OpenTerritoryMap.tsx`, `web/lib/territory-map-style.ts`, `web/app/globals.css`, and their existing tests.

- [ ] Remove polygon drawing, vertex handles, polygon lists/editors, and their map layers/styles.
- [ ] Support click-to-select, Shift-click toggle, Shift-drag rectangle selection, empty-map/Escape clearing, and a one-shot **Select area** control for touch.
- [ ] Include revealed hidden segments in the same selection and activate only those exact segments.
- [ ] Add the compact selection tray, status-specific actions, live counts, and searchable keyboard fallback.
- [ ] Keep selection halos and segment actions intact across map/satellite changes.

### Task 3: Integrate and reach the founder-review checkpoint

**Primary files:** existing territory, workspace, API, and map tests touched by Tasks 1–2.

- [ ] Run focused tests while implementing each behavior and correct functional regressions.
- [ ] Run TypeScript and the relevant territory/workspace test set once after integration.
- [ ] Perform one browser pass covering pointer, touch-sized layout, Save/Cancel, hidden roads, and map/satellite switching.
- [ ] Stop with the feature running locally for founder review; defer minor visual polish to the next inline feedback pass.
