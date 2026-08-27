# Task 04: Deepen the Region Setup workflow

## Objective

Move Region Setup draft transitions, transport, import observation, uncertain-result recovery, and accepted saved state behind one deep workflow interface. Leave React responsible for rendering and direct interaction adapters.

Replace implementation-text tests with behavior tests through the workflow interface and rendered accessibility behavior.

## Program position

- Branch: `codex/arch-04-region-workflow`
- PR base: `codex/architecture-review`
- Depends on: Tasks 01 through 03 merged
- Required next task: Task 05

Follow `ORCHESTRATION.md` for the complete task cycle.

## Required context

Read:

- `PRODUCT.md` Region Setup behavior and apartment deferral.
- The Phase 9 Region Setup checkpoint in `IMPLEMENTATION_PLAN.md`.
- `docs/APARTMENTS_MVP_DEFERRAL.md`.
- `web/components/TerritoryEditor.tsx`.
- `web/components/StreetlightWorkspace.tsx`.
- `web/lib/territory-client.ts`.
- `web/lib/territory-import.ts`.
- `web/components/operation-state.ts`.
- `web/components/apartment-mutation-state.ts`.
- `web/components/StreetlightWorkspace.test.mjs`.
- The Task 03 territory-import lifecycle interface.

## Observed pressure

At the reviewed commit, `TerritoryEditor.tsx` has 1,686 lines, 26 local state variables, 7 effects, and 5 direct fetch calls. It owns address search, geocoding, draft state, exact-segment selection, import-required saves, import polling, uncertain responses, retry and reload policy, apartment mutations, unsaved-change reporting, and rendering.

Several helper modules contain useful calculations, but understanding one save still crosses the UI implementation and multiple helpers. Recent commits fixed interaction between region saves and apartment recovery actions.

`StreetlightWorkspace.test.mjs` contains 31 tests and 214 `assert.match` or `assert.doesNotMatch` calls. Many assertions parse source text, callback names, CSS fragments, or exact implementation structure. Those tests can pass while ordering or browser behavior is broken.

## Scope

### Workflow ownership

Select one interface that owns the current Region Setup lifecycle:

- Initialize from the saved workspace.
- Edit address, center, radius, shape, exclusions, and exact segment overrides.
- Derive dirty state and leave protection.
- Save a contained draft.
- Submit an import-required draft through Task 03.
- Observe import progress and adopt successful persisted state.
- Preserve the prior accepted state after rejection, uncertainty, failure, or interruption.
- Expose retry or reload recovery when the outcome requires it.

The interface includes ordering, error modes, and state guarantees. React callers should not coordinate fetch response parsing, retry identity, import polling, or accepted-state replacement.

### Dependency handling

Treat browser fetch and clock or polling behavior as dependencies at internal seams. Use production adapters and deterministic test adapters where two real adapters exist. Do not expose test controls through the workflow's external interface.

Keep map selection as an interaction input and derived display state. Task 05 owns MapLibre lifecycle, not Region Setup.

### Replace shallow helpers and source tests

Consolidate helper behavior behind the workflow when that improves locality. Remove old helpers and unit tests that become pass-through checks. Keep pure geographic functions whose interfaces already hide meaningful calculations.

For `StreetlightWorkspace.test.mjs`:

- Replace save, import, retry, reload, dirty-state, and apartment-capability claims with workflow or rendered behavior tests.
- Delete assertions that preserve variable names, callback names, source order, CSS syntax, or exact JSX structure without protecting user behavior.
- Keep accessibility assertions through rendered markup or browser state.
- Leave map-lifecycle assertions for Task 05 and reconciliation-specific assertions for Task 06.

### Apartment deferral

Keep `APARTMENTS_ENABLED = false` as the single product capability. The workflow may retain private apartment state needed to preserve dormant code and stored data, but no apartment behavior becomes reachable in the MVP.

Do not deepen apartment UX, add another flag, or add rollout configuration.

## Required invariants

- New churches see Region Setup until the first successful region save.
- An established church can keep using its prior saved region during a replacement import.
- Contained changes reuse the current import footprint.
- Expanded footprints use the persisted lifecycle from Task 03.
- Dirty-state and leave protection reflect accepted versus draft state.
- Uncertain mutation outcomes require reload verification before another conflicting mutation.
- Confirmed client rejection permits a retry and preserves the edited draft where approved.
- Failed imports preserve the prior region and history.
- Exact segment activation and exclusion remain exact.
- Accessibility status, focus, and recovery actions remain reachable.
- Apartment controls, markers, counts, and mutations remain unavailable.

## Acceptance criteria

1. React no longer owns fetch parsing, import polling order, retry identity, or accepted-state replacement.
2. The workflow interface is smaller than the state and helper knowledge it replaces.
3. Tests use the same workflow interface as production callers.
4. Focused tests cover contained save, import-required save, progress, refresh, success, rejection, uncertainty, failure, interruption, retry, reload verification, dirty state, and leave protection.
5. Source-text assertions for Region Setup behavior are removed.
6. The editor renders from workflow state and keeps current user-visible behavior.
7. No dormant apartment behavior becomes reachable.
8. Old helpers, exports, effects, and tests disappear when the workflow replaces them.
9. No state-machine dependency or generic manager module is added.

## Focused verification

```text
pnpm --dir web exec node --test components/operation-state.test.ts components/apartment-mutation-state.test.ts
pnpm --dir web exec node --test lib/territory-client.test.ts lib/territory-import.test.ts
pnpm --dir web exec node --test app/api/territory/route.test.ts app/api/territory/import/route.test.ts
pnpm --dir web exec node --test <new Region Setup workflow tests>
pnpm --dir web exec node --test components/StreetlightWorkspace.test.mjs
```

Then run every program check from `ORCHESTRATION.md`.

Run a signed-in browser check at desktop and portrait-tablet widths when an authenticated session is available. Exercise one contained edit, one exact-road edit, one import-required draft with deterministic test data, and recovery from a forced failed request. If the session is unavailable, task integration may proceed after automated review, but the final integration PR remains blocked at its signed-in browser gate.

## Reviewer focus

The reviewer must answer:

- Is this one deep workflow module or a new layer over the same React orchestration?
- Does React know less about transport and lifecycle ordering?
- Can tests change the implementation without source-string churn?
- Do uncertainty, retry, reload, and leave-protection states remain reachable?
- Did any helper stay public only because an old test imports it?
- Are apartments still hidden through one capability seam?
- Did the change alter Phase 9 presentation or product copy outside the task?

## Excluded work

- Visual redesign or new Region Setup features.
- Apartment optimization.
- MapLibre source, layer, or style lifecycle changes.
- Reconciliation workflow changes.
- Phase 9 approval or status changes.

## Completion evidence

The PR must include:

- The selected workflow interface and hidden implementation responsibilities.
- Removed React effects, helper exports, and source-text assertions.
- Recovery-state test results.
- Browser observations or the final-integration browser blocker.
