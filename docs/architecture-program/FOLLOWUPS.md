# Streetlight architecture program follow-ups

Status: implementation and agent acceptance complete; founder review remains, August 26, 2026

This ledger records residual architecture work found after Tasks 01 through 06 merged into
`codex/architecture-review`. Phase 9 UI acceptance items remain in
[`IMPLEMENTATION_PLAN.md`](../../IMPLEMENTATION_PLAN.md#tracked-follow-ups).

| ID | Status | Finding | Acceptance |
|---|---|---|---|
| `ARCH-F01` | Resolved in PR #10 | `reconciliation-workflow.ts` now owns validated loading, accepted and draft state, mutation sequencing, exact retry identity, correction, undo, and uncertain recovery behind `getSnapshot`, `subscribe`, and `act`. React only renders snapshots and translates events. | The focused reconciliation suites pass 33 tests, including malformed successful GET responses and exact retry behavior. Signed-in Chrome acceptance loaded the empty reconciliation state without an application error. |
| `ARCH-F02` | Resolved in PR #10 | Import fingerprints now hash only semantic fields. Set-like segment IDs are sorted and deprecated `apartmentStatuses` no longer changes identity. Stored drafts and input validation are unchanged. | Reversed equivalent inputs reuse the same active job. The focused importer suites pass 37 tests. |
| `ARCH-F03` | Resolved in PR #10 | Shared mutation parsing and apartment mutation state moved under `web/lib`. Region workflow code no longer imports from `components`. Finalization focus stays in its one rendered caller. | The focused workflow and operation suites pass 45 tests. Signed-in Chrome acceptance confirmed focus enters `Confirm finalization` and returns to `Finalize & download` on cancel. |
| `ARCH-F04` | Resolved in PR #10 | `database.test.mjs` fell from 2,330 to 725 lines. Observable coverage, packet, territory, apartment, draft, and demo behavior now lives in focused persistence suites. Migration, constraint, trigger, transaction, and rollback invariants remain in the database suite. | The seven destination suites pass 35 direct tests. `map-overlay-lifecycle.test.ts` remains whole because its shared provider model has not shown independent churn; split it only after repeated independent changes justify another seam. |
| `ARCH-F05` | Resolved in PR #10 | `ORCHESTRATION.md` now opens with a historical-program banner naming PRs #3 through #10 and forbidding a restart of the completed task cycle. | The architecture branch remains isolated until final signed-in acceptance and founder approval. |
| `ARCH-F06` | Resolved in PR #10 | The supported Turbopack ignore annotation prevents broad dynamic process tracing, while `next.config.mjs` explicitly includes the importer entry point for the territory import route. | Production build output has no trace warning. Route traces contain 114 to 115 files rather than the whole project, and a live pinned Overture import passed. |
| `ARCH-F07` | Resolved during PR #10 acceptance | A failed import draft restored its radius from the workflow, but the local input reset to the previously accepted radius. A legacy accepted radius above the current maximum disabled the visible `Try save again` action. | The input now follows workflow draft radius changes. Signed-in Chrome acceptance preserved an exact 1.8-mile failed draft across reload, enabled retry, completed the live import, and retained `1.8-mile` after another reload. |

None of these items reopens apartment work for the MVP. The live Google Satellite check tracked as
`P9-F02` in `IMPLEMENTATION_PLAN.md` passed on the merged architecture head. The architecture
program has no remaining technical follow-up; final integration still requires founder approval.
