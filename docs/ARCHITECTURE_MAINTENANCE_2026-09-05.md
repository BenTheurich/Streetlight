# Streetlight architecture maintenance

Implemented on 5 September 2026 against the working tree on `codex/phase-11-public-site`.
This covers the repository changes proposed in the architecture and Ponytail review. The
existing public-site and demo work was preserved. No product decisions or phase statuses changed.

The three reproduced defects are fixed:

| Failure | Implemented protection | Regression evidence |
|---|---|---|
| Two churches importing the same geography at the same generation collided on a primary key. | New physical street and apartment IDs include territory identity. Imported, preserved, and restored rows follow the same rule. Existing referenced IDs remain intact. | Imports for overlapping churches across three generations, including preserved manual streets and apartment evidence, pass in `territory-persistence.test.ts`. |
| Undoing a completion after reimport could reserve the same logical street twice. | Undo compares church, territory, and imported geographic identity across stored versions, inside the existing transaction. Preserved apartment packets use the equivalent check. | Complete A, reimport, reserve the same geography in B, then undo A is rejected without adding a correction. Cancel B and undo A succeeds. Both street and apartment cases pass in `reconciliation.test.ts`. |
| Automatic PDF download or retry could select another administrator's newer batch. | Finalization and retry retain the returned batch ID. The PDF route supports an exact batch lookup scoped to the authenticated church. Explicit newest-batch and all-active downloads remain available. | Route and workflow tests cover competing batches, foreign/missing/draft batches, malformed query parameters, refresh failure, and exact-batch retry. |

No data migration is required. Older packet references and append-only coverage history remain
valid. The distinction between a street segment and its imported versions is recorded in
[CONTEXT.md](../CONTEXT.md).

Packet preparation now owns proposal editing, finalization, coverage refresh, download, and
recovery in [packet-preparation.ts](../web/lib/packet-preparation.ts). Its operation state locks
requests synchronously, including during refresh. An uncertain finalization requires a reload
instead of allowing another potentially duplicate mutation. `PacketGenerator` renders the
snapshot and retains focus handling; tests exercise the same workflow used by the component.

Outreach Progress now owns its period, playback clock, reduced-motion response, presentation,
printing, and camera restoration in
[outreach-progress-workflow.ts](../web/lib/outreach-progress-workflow.ts) and
[useOutreachProgress.ts](../web/components/useOutreachProgress.ts). The workspace supplies coverage,
camera, active-tool state, and the map lifecycle.

Printing waits for React to commit the paper layout and for MapLibre to finish rendering. When
Satellite is selected, it also waits for Google's visible tiles. The wait is cancellable and has
the same two-minute limit as packet-map capture. The paper layout stays active until `afterprint`;
completion, cancellation, and errors restore the camera. Review also caught and fixed a fullscreen
request that could complete after leaving presentation mode. A stale request now exits fullscreen
without disrupting a newer presentation.

The cleanup removed these specific sources of maintenance work:

- Unused freeform polygon intersection and simplicity algorithms, with their exclusive tests.
  Circle and square boundary geometry remains.
- The retired rolling coverage-total helper. Surviving tests now assert current coverage
  distribution or stored dates and totals directly.
- Cast-heavy dynamic imports and copied function signatures in map tests. Typed imports retain
  the behavior assertions.
- The handwritten parent `.env.local` parser. Maps read the environment loaded by Next.js;
  `web/.env.local` is the documented local configuration source. Existing local secrets were not
  changed.
- The dead landing demo-toast handler, styles, and fixture, plus the one-line
  `outreachProgressStepCount` wrapper.
- Packet-operation Boolean plumbing and a source-text assertion about map ownership. Workflow
  tests and executed React mount/update/unmount checks cover the underlying behavior.

The web test command now discovers test files in the application source directories. All 58
previous test files remain included, and the three new workflow/readiness suites are discovered
automatically. The TSX test loader now accepts only file candidates during resolution; this
prevents directory imports from breaking PDF dependencies when the loader runs across the suite.
[README.md](../README.md) and [ENVIRONMENTS.md](../ENVIRONMENTS.md) describe the current workspace,
packet workflow, environment loading, and Phase 12 deployment responsibilities.

Measured against the task-start source snapshot, `PacketGenerator.tsx` fell from 593 to 397 lines
and `StreetlightWorkspace.tsx` from 622 to 434. The stale-code and test-plumbing cleanup removed
358 lines net. Across all changes, production code grew by 294 lines and tests/test support by
859 lines. These counts exclude documentation and the pre-existing public-site work. The extra
production code implements lifecycle, rendering, cancellation, and recovery rules that previously
lived implicitly in component ordering. No dependencies or services were added.

Verification completed:

| Check | Result |
|---|---|
| `pnpm lint` | Biome checked 177 files without errors. |
| TypeScript, `tsc --noEmit --incremental false` | Passed without writing incremental build state. |
| Root `pnpm test` | 351 application checks, 4 Python-launcher checks, and 71 importer checks passed: 426 total, no failures or skips. |
| Rendered contracts after final fixture cleanup | All 8 passed. |
| Production build | Next.js 16.3.0 Turbopack compilation, TypeScript, and static page generation passed in an isolated source copy. |
| Chromium component checks | Actual React progress ownership and StrictMode print ordering passed. The actual packet component passed generation, focus restoration, tool switching, operation locks, parent-state updates, refresh failure, and exact-batch PDF retry. The packet check triggered one PDF Blob download with no page errors. |
| Isolated production browser check | `/`, `/how-it-works`, `/pricing`, and `/why-streetlight` rendered successfully. Signed-out coverage and exact-batch PDF requests returned 401. No browser page errors occurred. |
| Independent review | Separate agents reviewed persistence, packet behavior, cleanup, and progress. The two additional progress findings were fixed and rechecked. |
| Diff review | `git diff --check` passed. The lockfile, phase plan, existing landing component, and demo implementation match their task-start copies. |

Build verification used an ignored copy under `tmp/maintenance-build-20260905-121908`, shared
installed dependencies, an isolated database path, and placeholder WorkOS configuration directed
at loopback. Only the temporary Next configuration set an explicit Turbopack root for those
dependency links. The canonical `.next` output and daily preview were not used. The temporary
server was stopped after verification.

The database regressions use disposable SQLite files. Provider responses in workflow tests are
fakes, and the production browser check blocked external browser requests. No live WorkOS
organization, invitation, Overture import, production database, or deployment was touched. Live
provider behavior and a physical printer were not tested. This work also does not claim a fresh
dependency-advisory or Git-history secret scan.

Phase 12 still owns public-request rate control, Google quotas and key restrictions, deployment,
backup, and demonstrated restore. Those existing launch gates remain pending. SQLite, the
MapLibre/Google provider split, production PDF dependencies, historical migrations, deferred
apartment recovery, and the Phase 0 archive remain because the review found current reasons to
keep them.

At the initial handoff, all changes remained uncommitted for review. No push, merge, or deployment
had been performed.

Ben then authorized committing and pushing the maintenance changes directly to `main`. Publication
was prepared in a separate checkout of `089233615dbeb97234bb1d687b2b283bb43d4d8f`. Only the 48
maintenance files were selected. Shared landing assets and rendered tests were reconstructed from
the saved task-start copies so the unfinished public-site work stayed out of the commit.

The maintenance-only checkout passed 348 application checks, 4 Python-launcher checks, and 71
importer checks, totaling 423. The three-check difference from the earlier 426 result comes from
unpublished public-site/demo work. Biome checked 172 files successfully, TypeScript passed, and
an isolated Next.js Turbopack production build passed. The original working files, index, branch,
and HEAD were preserved during publication preparation.
