# Phase 9 Founder UX Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the authenticated Streetlight workspace to the founder-approved Phase 9 human-review checkpoint without changing its deterministic workflow or starting Phase 10.

**Architecture:** Keep the persistent map workspace and existing feature ownership. Establish the shared visual/state vocabulary first, then wire existing async operations, refine Coverage, and improve apartment rendering in separate reviewed increments. State stays with the components that already own each operation; shared UI remains presentational.

**Tech Stack:** Next.js 16, React 19, TypeScript, MapLibre GL, SQLite, Node test runner, Python importer tests, Biome, Playwright/Browser or Chrome for bounded visual verification.

## Global Constraints

- `PRODUCT.md` is product authority; the approved design is `docs/superpowers/specs/2026-08-01-phase9-founder-ux-polish-design.md`.
- Work only on Phase 9 and stop at its human-review checkpoint. Do not implement Outreach Progress, combined Packets navigation, Setup/Printouts settings, or packet-footer customization.
- Keep Streetlight deterministic and AI-free.
- Preserve the landing-page composition, Coverage legend, Current estimated progress bar, basemap, packet proposal overlays, and packet-PDF cartography except where a verified regression requires a small correction.
- Preserve Map/Satellite camera synchronization and every existing territory, generation, finalization, download, and reconciliation workflow.
- Prefer native platform and already-installed capabilities. Add no dependency for search, status UI, icons, or clustering.
- Use Impeccable in Operate mode for UI judgment. Read its current context and relevant playbook before editing; load its craft floor immediately before UI edits.
- Treat `DESIGN.md` as authority. Do not propagate the stale `.impeccable/design.json` snippets into production.
- Keep public and workspace component variants distinct.
- Maintain 44-pixel targets, visible focus, keyboard operation, sufficient contrast, truthful announcements, and reduced-motion behavior.
- Use task-focused tests. Add the smallest durable behavioral check for non-trivial logic; do not rely only on source-regex assertions when a pure behavior test is practical.
- Make one task-scoped commit after each accepted workstream. Never stage unrelated files.

## Implementation Latitude

This plan defines outcomes and boundaries rather than exact component trees, function signatures, CSS declarations, or test bodies. Each implementation subagent should inspect the current code, reuse existing patterns, and choose the smallest coherent solution. Impeccable may influence composition, state treatment, spacing, glyph selection, and micro-interaction details as long as the product rules and acceptance evidence below remain true.

If a listed file is not the natural owner after inspection, the subagent may use a better existing owner and explain the choice. New files are optional unless isolation materially improves clarity or testability.

## Orchestration Model

- The root agent owns integration, scope, and the Phase 9 result.
- Use one fresh implementation subagent per workstream.
- Do not run writing agents concurrently when they may touch `web/app/globals.css`, `StreetlightWorkspace.tsx`, `CoverageDashboard.tsx`, `TerritoryEditor.tsx`, or shared map styles.
- After each implementation, run a requirements review and a code-quality review before accepting the commit.
- Read-only audits and bounded verification may run in parallel when they do not anchor an unfinished design decision.
- The root agent resolves cross-task trade-offs and runs final checks; subagents do not independently broaden product scope.

---

### Task 0: Reconcile and preserve the existing Phase 9 baseline

**Purpose:** Start UX work from a known, reviewable branch without losing the existing uncommitted building-selection/import work.

**Likely scope:**

- current dirty benchmark, importer, database, migration, test, documentation, and evidence files;
- `IMPLEMENTATION_PLAN.md` only where the existing work already updates Phase 9 evidence.

- [ ] Inspect the complete dirty diff and map each change to the existing building-selection benchmark design and plan.
- [ ] Identify generated/debug artifacts that should remain untracked versus durable source/evidence that belongs in the branch. Do not delete or ignore uncertain user-owned files without root review.
- [ ] Run the smallest relevant benchmark/import/database checks, then the broader affected suites.
- [ ] Fix only defects inside the already-started benchmark/import scope if the evidence is otherwise complete.
- [ ] Present the root agent with the intended commit set, verification results, and any unresolved files.
- [ ] After root approval, commit only the reconciled baseline work. Leave the worktree clean before UX implementation begins.

**Acceptance evidence:** The branch has a clean, explained baseline; existing benchmark/import work is preserved; no UX behavior changed; relevant checks pass or a concrete blocker is reported.

---

### Task 1: Establish the operational design and state foundation

**Purpose:** Give later UX work one coherent set of operational tokens, focus/state behavior, and reusable status presentation.

**Likely files:**

- `DESIGN.md`
- `web/app/globals.css`
- a focused shared status component if the current component structure benefits from one
- relevant component/style tests

- [ ] Inspect incumbent landing and workspace styles before choosing changes; preserve their intentional surface differences.
- [ ] Add or clarify only the shared operational tokens the approved design actually needs: selected blue, focus treatment, quiet hover, warning/error surfaces, and floating/recovery elevation.
- [ ] Fix the inactive tool hover so it cannot cover the sliding navy selection indicator.
- [ ] Align focus visibility and control boundaries with contrast requirements on both Church Paper and Bright Paper.
- [ ] Define a small presentational operation-status treatment with surface and global placements, truthful announcement semantics, and reduced-motion behavior.
- [ ] Keep loading ownership local; do not add a provider, global loading flag, fake percentage, or map blocker.
- [ ] Add targeted checks for the shared state contract and the tool-switcher regression.
- [ ] Use Impeccable judgment for exact visual treatment, then show the root agent the changed states before committing.

**Acceptance evidence:** The workspace has coherent reusable state styling; the moving active indicator remains visually continuous under hover; focus and boundaries are visible; reduced motion preserves every state; protected public styling remains intact.

---

### Task 2: Apply truthful operation status to existing workflows

**Purpose:** Make real waits, failures, and recoveries visible without changing workflow state or hiding safe work.

**Likely files:**

- `web/components/PacketGenerator.tsx`
- `web/components/TerritoryEditor.tsx`
- `web/components/ReconciliationTool.tsx`
- `web/components/StreetlightWorkspace.tsx` only if a later background import needs shared placement
- existing packet-progress and workspace tests

- [ ] Reuse the existing proposal-generation, PDF-download, territory-import, and reconciliation loading state instead of inventing parallel state.
- [ ] Give proposal generation and PDF preparation adjacent, layout-reserving status with specific copy and existing recovery behavior.
- [ ] Distinguish blocking first import from later background expansion: the first stays in Setup; the later remains persistent without preventing other tools.
- [ ] Keep errors next to the failed action, state what remains safe, and retain explicit retry or return actions.
- [ ] Preserve entered packet sizes, generated proposals, finalized batches, saved territory, and reconciliation state through failures.
- [ ] Ensure status announcements are atomic and do not steal focus or duplicate live-region output.
- [ ] Add behavioral checks around operation ownership, disabled controls, recovery, and the existing packet-count progress copy.

**Acceptance evidence:** Every named operation communicates real progress and failure in context; no operation dims the workspace; safe work survives; reduced motion and screen readers receive an equivalent state.

---

### Task 3: Refine Coverage search, selection, and Current Work

**Purpose:** Let administrators find and understand a street without internal hashes, while keeping the normal next action continuously available.

**Likely files:**

- `web/components/CoverageDashboard.tsx`
- `web/components/OpenCoverageMap.tsx`
- `web/components/StreetlightWorkspace.tsx`
- a small pure search/camera helper if that produces a clearer test boundary
- `web/app/globals.css`
- Coverage, workspace, and camera tests

- [ ] Remove the arbitrary initial segment selection so Coverage opens on the whole territory with an instructional state.
- [ ] Replace the segment dropdown with a native search field and keyboard-operable result buttons.
- [ ] Match trimmed street names without exposing segment IDs; cap visible results and provide initial, count, refinement, and no-results feedback.
- [ ] Give each result the human context approved by the design: street name, estimated tracts, last outreach, and eligible/excluded state.
- [ ] Preserve the existing correction history and add useful selected context such as coverage range and exclusion reason where data already exists.
- [ ] Make search-originated selection clearly highlight and fit the street with bounded, sidebar-aware camera behavior; map-originated selection updates details without a jarring recenter.
- [ ] Preserve Map/Satellite synchronization and use immediate camera movement under reduced motion.
- [ ] Dock Current Work outside the Coverage detail scroller, keep its two factual states, and remove decorative use of factual coverage color.
- [ ] Do not add a notification bell, unread state, or activity history.
- [ ] Add focused behavioral tests for filtering, result limits/order, hidden IDs, selection source, camera bounds, and Current Work actions.

**Acceptance evidence:** An administrator can find duplicate and unnamed streets without hashes, understand the selected segment, operate the flow by keyboard, and always reach the correct next action. The legend and progress bar are unchanged.

---

### Task 4: Improve apartment markers, clustering, and accessible selection

**Purpose:** Keep apartment complexes legible from territory overview to neighborhood zoom while ensuring every complex remains reachable without relying on canvas interaction.

**Likely files:**

- `web/lib/open-map-style.ts`
- `web/components/OpenCoverageMap.tsx`
- `web/components/OpenTerritoryMap.tsx`
- `web/components/TerritoryEditor.tsx`
- map/style and territory interaction tests

- [ ] Add native MapLibre clustering with a modest radius and a neighborhood-scale maximum zoom.
- [ ] Render mixed-state clusters in a neutral treatment with abbreviated counts; keep individual factual state colors after clusters separate.
- [ ] Expand clusters through native cluster behavior and ensure every overlay visibility toggle includes the new layers.
- [ ] Prevent cluster and marker interaction from leaking into exclusion drawing or other territory-edit gestures.
- [ ] Add a native apartment selector in Territory Setup using address availability, review state, and estimated tracts; synchronize it with map selection and the existing detail card.
- [ ] Keep closer user-selected zooms; only raise a distant view enough to understand the selected complex.
- [ ] Use one bounded Impeccable/browser comparison for the individual marker glyph. Choose the clearest dependency-free treatment that survives Map/Satellite style reloads and preserves state color; use a refined `A` if image lifecycle or contrast makes alternatives less reliable.
- [ ] Leave packet-PDF map rendering and proposal overlays unchanged.
- [ ] Add tests for source clustering, cluster/count layers, unclustered filters, visibility parity, selection synchronization, and drawing isolation.

**Acceptance evidence:** Overlapping complexes produce truthful count clusters, individual complexes reappear at useful zooms, mouse and keyboard selection agree, and map editing cannot be triggered accidentally.

---

### Task 5: Integrate, audit, and refresh design evidence

**Purpose:** Resolve cross-workstream inconsistencies before expensive browser verification.

**Likely files:**

- touched Phase 9 UI and test files
- `DESIGN.md`
- `.impeccable/design.json` through the supported Impeccable refresh workflow
- `IMPLEMENTATION_PLAN.md` only for verified Phase 9 evidence

- [ ] Review the combined implementation against every section of the approved design and `PRODUCT.md`.
- [ ] Resolve duplicated state styling, inconsistent copy, focus gaps, or map-layer lifecycle issues in one bounded integration pass.
- [ ] Confirm protected surfaces changed only where an actual regression required it.
- [ ] Run the Impeccable detector once over the completed changed UI targets; classify and fix real findings in one batch.
- [ ] Refresh the stale Impeccable sidecar only after `DESIGN.md` and implementation agree.
- [ ] Update Phase 9 evidence with checks that have actually run; do not mark the phase complete.
- [ ] Dispatch independent requirements and quality reviewers, then address accepted findings without expanding scope.

**Acceptance evidence:** Product, design authority, sidecar, code, and evidence agree; no known Critical or Important review finding remains; the phase is ready for final automated and browser verification.

---

### Task 6: Run final verification and prepare founder review

**Purpose:** Prove that the refined interface is usable, deterministic, accessible, and ready for the required founder decision.

- [ ] Run targeted checks for each affected area, followed by the full Node suite, Python importer suite, Biome, TypeScript, credential-safe production build, and diff checks.
- [ ] Use Browser for reproducible seeded checks and Chrome only when the existing authenticated/WorkOS session materially helps.
- [ ] Perform one combined desktop and portrait-tablet inspection covering tool hover, keyboard segment search, selected-map focus, Current Work states, imports, proposal generation, PDF preparation, recovery, apartment clusters, apartment selection, Map/Satellite, and reduced motion.
- [ ] Confirm under the production server that the Next.js development `N` is absent without product CSS.
- [ ] Inspect the landing page, legend, Current estimated progress bar, and representative packet PDF for unintended change.
- [ ] Fix all observed defects in one batch, then perform at most one confirmation pass.
- [ ] Record exact automated and browser evidence in `IMPLEMENTATION_PLAN.md`.
- [ ] Produce the standard Phase 9 handoff: status, changes, checks, browser results, limitations, exact founder-review steps, and any decision needed.
- [ ] Stop. Do not begin Phase 10 until the founder approves Phase 9.

**Acceptance evidence:** All required checks pass, browser controls are reachable at desktop/tablet widths, accessibility basics hold, protected surfaces remain stable, and the founder receives a complete review checklist.
