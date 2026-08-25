# Task 06: Deepen reconciliation and close the audit backlog

## Objective

Give one reconciliation module ownership of physical-sheet decisions, append-only coverage meaning, conflict policy, correction, undo, and persisted results.

Close the remaining audit backlog by replacing leftover implementation-text tests, resolving the existing Biome diagnostics without blanket suppression, rescanning dependencies and secret history, and accounting for every security or deployment disposition from earlier tasks.

## Program position

- Branch: `codex/arch-06-reconciliation-domain`
- PR base: `codex/architecture-review`
- Depends on: Tasks 01 through 05 merged
- Required next action: final integration gate in `ORCHESTRATION.md`

Follow `ORCHESTRATION.md` for the complete task cycle.

## Required context

Read:

- `PRODUCT.md` batch, packet, reconciliation, correction, and coverage-history rules.
- The reconciliation and Phase 9 checkpoints in `IMPLEMENTATION_PLAN.md`.
- `web/lib/reconciliation.ts` and its tests.
- The reconciliation persistence module produced by Task 02.
- `web/app/api/reconciliation/route.ts` and its tests.
- `web/components/ReconciliationTool.tsx`.
- `web/components/OpenReconciliationOverlay.tsx` after Task 05.
- All remaining component tests that use `readFileSync` to inspect production source.
- Current Biome output, production dependency audit, and Git history secret scan.
- PR dispositions from Tasks 01 through 05.

## Observed pressure

The reviewed code splits reconciliation across client preview helpers, request parsing, route error mapping, SQLite transitions, UI mutation state, and map selection.

`database.ts` contained two interpretations of append-only coverage events: `packetCoverageHistory` at line 1313 and `effectivePacketRoots` at line 1625. Task 02 may move those functions, but Task 06 must make one module own their shared meaning.

The reviewed Biome run exits successfully with 31 warnings and 4 informational diagnostics. Reported categories include intentional image markup, CSS `!important`, and simple string-concatenation suggestions. The task must judge each current diagnostic on the latest integration head.

The audit also found many source-text tests outside Region Setup and maps. These tests need behavior replacements or deletion when they only preserve implementation syntax.

## Scope

### Reconciliation ownership

Select one interface that owns:

- Loading batches needing action and compact history.
- Requiring one explicit outcome per physical sheet.
- Deriving complete, active, and canceled packet results.
- Applying an idempotent reconciliation.
- Interpreting append-only completion roots and corrections.
- Correcting a completed packet date.
- Undoing a correction when no reservation conflict prevents it.
- Reporting conflicts and persisted results.

The module must hide event-reduction order, row shapes, transaction order, and retry identity. UI and route adapters translate user intent and render returned state.

Use the workflow persistence seam from Task 02. Do not add a generic event framework.

### One append-only interpretation

Replace duplicated coverage-event reduction with one owned interpretation used by reconciliation, correction, undo, and history projection. Preserve insertion-order and root-event invariants defined by `PRODUCT.md` and existing migration constraints.

Tests must prove that correction, void, restore, and undo produce the same effective result everywhere the application reads coverage history.

### Remaining implementation-text tests

Inventory every remaining test that reads production source or CSS and uses match assertions. For each assertion:

- Replace it with a test through a production interface, rendered markup, HTTP result, browser behavior, or exact deterministic style output when user behavior matters.
- Delete it when it only preserves a variable name, callback, file import, source order, class declaration, or CSS syntax.
- Keep source inspection only for a repository policy that cannot be observed at runtime, and document that reason beside the test.

Do not chase a target test count. The completion criterion is that each remaining source inspection protects a named policy rather than implementation shape.

### Biome diagnostics

Run Biome with enough diagnostics to account for every current item. Fix safe issues that do not change approved presentation. Add a narrow local suppression only when the exact construct is intentional and the comment names the reason. Do not disable a rule globally to make the report empty.

Image changes on the public landing and CSS specificity changes require rendered browser comparison. If converting an image to `next/image` changes animation, layout, asset loading, or static export behavior, retain the current element with a local explanation.

### Security and maintenance closeout

Re-run:

- Production dependency audit.
- Gitleaks across all reachable commits.
- API route authentication classification.
- Workspace-isolation tests affected by the program.
- Security-header browser matrix from Task 05.

Check the earlier dispositions for public pilot rate control and Google quota control. An item deferred to Phase 12 must name the provider setting, owner, verification command, and reason code was premature. No item may remain as an unowned note.

## Required invariants

- Every physical sheet receives one explicit outcome before reconciliation.
- Reconciliation is idempotent and atomic.
- Completed coverage remains append-only.
- Corrections reference valid roots and never overwrite history.
- Undo rejects reservation conflicts and preserves unrelated history.
- Cross-church batch, packet, event, and correction IDs remain inaccessible.
- The selected reconciliation map highlight follows current user selection.
- Uncertain client outcomes require reload verification before another conflicting mutation.
- Apartment packets and mutations remain unavailable in the MVP.
- No lint cleanup changes approved product presentation without browser evidence.

## Acceptance criteria

1. One module owns physical-sheet transition and append-only coverage meaning.
2. Duplicate event-reduction implementations disappear.
3. Route and UI callers know less about persistence, event ordering, and conflict derivation.
4. Tests cover complete, active, canceled, replayed, corrected, voided, restored, undone, conflicting, stale, malformed, and cross-church cases through the selected interface.
5. Remaining source-text tests each contain a nearby explanation of the non-runtime policy they protect; implementation-shape assertions are gone.
6. Every Biome diagnostic is fixed or narrowly justified. No blanket rule is disabled.
7. Production dependency audit has no unresolved advisory, or the final integration PR is blocked with the exact incompatible patch decision.
8. Gitleaks reports no secret in reachable history, or the program stops for credential response.
9. Pilot-request rate control, Google quota control, and security headers each have implemented evidence or an exact Phase 12 owner and verification step.
10. All six task briefs and every audit-accounting row have a final disposition.

## Focused verification

```text
pnpm --dir web exec node --test lib/reconciliation.test.ts
pnpm --dir web exec node --test app/api/reconciliation/route.test.ts
pnpm --dir web exec node --test components/operation-state.test.ts
pnpm --dir web exec node --test components/StreetlightWorkspace.test.mjs
pnpm audit --prod --audit-level low
pnpm --dir web exec biome check . --max-diagnostics=200
gitleaks git --redact --log-opts="--all"
```

Then run every program check from `ORCHESTRATION.md`.

Run a signed-in reconciliation browser check:

1. Select a batch needing action.
2. Choose one outcome for every physical sheet.
3. Confirm and observe coverage and active-packet changes.
4. Reopen history and correct one completed date.
5. Undo the correction.
6. Exercise a conflict and an uncertain response.
7. Confirm selected-batch map highlighting survives style replacement.

If an authenticated session is unavailable, the task PR may merge into the integration branch after automated checks and reviewer approval. The final integration PR remains blocked until the browser check passes.

## Reviewer focus

The reviewer must answer:

- Is append-only coverage meaning implemented once and consumed everywhere?
- Is the reconciliation module deep, or did the change add wrappers around persistence calls?
- Do route and UI tests cross the same interface as production callers?
- Can correction or undo change unrelated coverage roots?
- Are source-text tests limited to named repository policies?
- Did lint cleanup alter landing, map, tablet, print, or reduced-motion behavior without evidence?
- Does every security and maintenance item have an implemented or Phase 12 disposition?

## Excluded work

- New reconciliation outcomes or partial-sheet workflows.
- Editable coverage history.
- Apartment reconciliation.
- Generic event sourcing.
- Public-site redesign.
- Phase 9 approval or deployment.

## Completion evidence

The PR must include:

- The selected reconciliation interface and deletion-test result.
- The removed duplicate event reducers.
- Reconciliation, correction, undo, conflict, and isolation test results.
- Source-test inventory and dispositions.
- Complete Biome diagnostic disposition.
- Dependency-audit and Gitleaks output.
- Security and Phase 12 disposition table.
- Browser observations or the final-integration blocker.
