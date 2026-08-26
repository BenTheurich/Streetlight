# Streetlight architecture program follow-ups

Status: final integration review, August 26, 2026

This ledger records residual architecture work found after Tasks 01 through 06 merged into
`codex/architecture-review`. Phase 9 UI acceptance items remain in
[`IMPLEMENTATION_PLAN.md`](../../IMPLEMENTATION_PLAN.md#tracked-follow-ups).

| ID | Status | Finding | Acceptance |
|---|---|---|---|
| `ARCH-F01` | Decision required before the final integration PR | Task 06 centralized persistence, append-only history, projection, conflicts, correction, and undo. `ReconciliationTool.tsx` still owns initial loading, mutation sequencing, retry identity, and accepted-state replacement. Its initial successful GET also casts the response without validating `isReconciliationWorkspacePayload()`. A strict reading of the Task 06 interface scope is therefore only partially satisfied. | Either move the client workflow behind a snapshot-oriented reconciliation interface tested through the same seam React uses, or record a founder decision that the completed server/domain seam satisfies Task 06. In either case, validate the initial GET and add a rendered malformed-response check. |
| `ARCH-F02` | Open, P3 | Territory import job fingerprints preserve the input order of `activatedSegmentIds` and `excludedSegmentIds`, although persistence treats both arrays as sets. Equivalent reordered API drafts can conflict instead of reusing one active import. Legacy `apartmentStatuses` also affects the fingerprint without affecting current persistence. | Canonicalize semantic draft fields before hashing, sort set-like arrays, and prove that reversed equivalent inputs reuse the same active job. |
| `ARCH-F03` | Open, P3 | `region-setup-workflow.ts` imports mutation helpers from `components`, while `operation-state.ts` mixes response parsing with two one-caller DOM focus helpers. The dependency direction makes workflow code harder to locate and reuse. | Move shared response and mutation logic under `web/lib`, keep focus wiring local to its rendered caller, and preserve behavior through interface or rendered tests. |
| `ARCH-F04` | Monitor during related changes | `web/db/database.test.mjs` remains a 2,330-line SQL-heavy test hotspot. `map-overlay-lifecycle.test.ts` is also large because it models the provider adapter in detail. | Move observable workflow behavior out of `database.test.mjs` when those tests next change, leaving migration, trigger, transaction, and rollback invariants there. Split map lifecycle tests by presentation mode only when independent changes cause repeated churn. |
| `ARCH-F05` | Pending after program merge | `ORCHESTRATION.md` still reads as an active six-task instruction set. A future agent could restart completed work. | After the final integration PR merges, add a completion banner naming the merged PR and commit and mark the task cycle historical. |
| `ARCH-F06` | Open, build warning | The production build succeeds, but Turbopack reports that the dynamic importer process spawn in `web/lib/overture-import.ts` causes the whole project to be included in the server trace. This can increase deployment size. | Keep the importer in the application container. Narrow or explicitly ignore the trace only through a supported Next.js mechanism, then compare the production output and rerun a real territory import. |

None of these items reopens apartment work for the MVP.
