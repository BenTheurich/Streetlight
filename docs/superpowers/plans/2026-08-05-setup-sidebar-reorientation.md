# Setup Sidebar Reorientation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Setup use Streetlight's approved task-first sidebar language while preserving the existing Region, Apartment, Road, Data Quality, and Save/Cancel workflow.

**Architecture:** Keep `TerritoryEditor` and native disclosures. Add small pure review helpers beside the existing territory map helpers, use one explicit road-focus request for search-origin selections, and reuse the existing selected-surface tokens for selected apartments. Replace the 74-item apartment dropdown with the same search-and-result pattern already approved in Coverage.

**Tech Stack:** React 19, TypeScript, MapLibre GL, native `<details>`, existing CSS tokens, Node test runner.

## Global Constraints

- Work only inside Phase 9 founder-directed UI/UX polish.
- Do not add navigation, dependencies, AI, providers, or speculative abstractions.
- Preserve exactly four top-level tools and Region/Printouts inside Setup.
- Preserve explicit Save/Cancel, draft recovery, exact road selection, and deterministic behavior.

---

### Task 1: Searchable, recognizable apartment review

**Files:**
- Modify: `web/lib/territory-map-style.ts`
- Modify: `web/lib/territory-map-style.test.ts`
- Modify: `web/components/TerritoryEditor.tsx`

**Interfaces:**
- Produces: `apartmentReviewOptions(apartments, segments, query)` returning sorted, uniquely labeled review options with a nearest named road cue.
- Consumes: existing `ApartmentComplex`, `TerritorySegment`, and `apartmentOptionLabel` contracts.

- [ ] **Step 1: Write failing tests** for nearest-road disambiguation, Needs-review-first sorting, filtering, and stable duplicate tie-breaking.
- [ ] **Step 2: Run `pnpm --dir web test -- lib/territory-map-style.test.ts` and confirm the missing helper fails.**
- [ ] **Step 3: Implement the minimum planar point-to-line distance and review-option builder.**
- [ ] **Step 4: Re-run the focused test and confirm it passes.**
- [ ] **Step 5: Replace the apartment dropdown with a search input and real result buttons using the helper; keep map selection and search selection synchronized.**

### Task 2: Geographic focus and road-selection clarity

**Files:**
- Modify: `web/lib/map-camera.ts`
- Modify: `web/lib/map-camera.test.ts`
- Modify: `web/components/OpenTerritoryMap.tsx`
- Modify: `web/components/TerritoryEditor.tsx`
- Modify: `web/components/StreetlightWorkspace.test.mjs`

**Interfaces:**
- Produces: `segmentSelectionBounds(segments, ids)` and a `roadFocusRequest` prop consumed by `OpenTerritoryMap`.
- Consumes: existing `coverageSelectionCameraOptions` and `positionBounds` camera behavior.

- [ ] **Step 1: Write failing tests** proving only requested segments determine focus bounds and the editor labels/opens the Road section when rectangular road selection is armed.
- [ ] **Step 2: Run the focused camera and workspace tests and confirm the new expectations fail.**
- [ ] **Step 3: Implement search-origin road focus using the shared camera options; do not pan for ordinary map clicks.**
- [ ] **Step 4: Rename the map control to `Select road area`, clarify its helper, and open Road segments when armed.**
- [ ] **Step 5: Re-run the focused tests and confirm they pass.**

### Task 3: Task-first hierarchy, readable type, and consistent surfaces

**Files:**
- Modify: `web/components/TerritoryEditor.tsx`
- Modify: `web/app/globals.css`
- Modify: `web/components/StreetlightWorkspace.test.mjs`

**Interfaces:**
- Consumes: existing `--selected`, `--selected-surface`, `--line`, `--panel`, and dirty-state calculation.
- Produces: no new reusable component API.

- [ ] **Step 1: Update the focused workspace contract test** for sentence-case headings, readable supporting copy, selected-surface apartment treatment, plain-language Data Quality impact, and quiet clean footer.
- [ ] **Step 2: Run the focused workspace test and confirm the new expectations fail.**
- [ ] **Step 3: Remove duplicate labels, rewrite Data Quality around workflow impact with secondary technical details, pluralize road copy, and add a dirty-state sidebar class.**
- [ ] **Step 4: Apply the smallest CSS change that establishes the approved hierarchy: 14–15px open headings, 12–14px metadata/copy, 44px hit targets, fewer separators, blue selected-object card, amber warnings only, and quiet disabled footer controls.**
- [ ] **Step 5: Re-run focused tests, TypeScript, and lint.**

### Task 4: Verification and founder-review evidence

**Files:**
- Modify only if evidence reveals a defect.

- [ ] **Step 1: Run the complete web test suite.**
- [ ] **Step 2: Run TypeScript and lint.**
- [ ] **Step 3: Inspect localhost at desktop width across collapsed, Region, apartment empty/selected, road empty/selected, Data Quality, dirty, and clean states.**
- [ ] **Step 4: Verify keyboard disclosures, search selection focus, map reviewability, Save/Cancel state, and reduced motion.**
- [ ] **Step 5: Update `IMPLEMENTATION_PLAN.md` Phase 9 evidence only after automated and browser verification.**
