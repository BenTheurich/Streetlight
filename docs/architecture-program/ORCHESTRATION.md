# Streetlight architecture program orchestration

## Objective

Run six architecture tasks in order. For each task, use an implementation agent, verify the result, obtain an independent reviewer-agent decision, publish one pull request, and merge only after Ben approves the exact ready head commit.

The program improves internal architecture without completing the Phase 9 founder-review checkpoint, changing product scope, or enabling apartments.

## Invocation prompt

Give the orchestrator this instruction with a link or path to this file:

```text
Execute the Streetlight architecture program in ORCHESTRATION.md. Run Tasks 01 through 06 sequentially. For each task, dispatch the required design agents, then one implementation agent that creates the task branch and owns the diff. Verify the implementation yourself, dispatch an independent read-only reviewer agent, repair valid findings within the review limit, and publish the task PR into codex/architecture-review. Pause only at a documented blocker or the required final human merge question. After an approved merge, resume from the updated integration branch and continue to the next task. Do not skip tasks, audit items, verification, reviewer gates, or the final signed-in integration check.
```

## Authority and starting point

Read these files before any task action:

1. Root `AGENTS.md`.
2. `PRODUCT.md`.
3. `IMPLEMENTATION_PLAN.md`.
4. This orchestration document.
5. The current task document.

`PRODUCT.md` remains the product authority. The six task briefs can change implementation structure and tests. They cannot change product behavior or phase completion status.

The reviewed program base is:

- Integration branch: `codex/architecture-review`
- Parent branch: `origin/codex/phase-9-ux-polish`
- Reviewed parent commit: `c43f67e03bf79b41040b4c1da28fb2457db25148`

Fetch `origin` before starting. Confirm that `origin/codex/architecture-review` exists and contains these documents. Confirm that `origin/codex/phase-9-ux-polish` has not advanced beyond the reviewed parent commit. If it has advanced, stop and report both commit IDs. Ben must decide whether to rebase the program before Task 01.

## Integration model

`codex/architecture-review` is the long-lived integration branch. Keep Phase 9 isolated by merging all six task PRs into this branch, not into `main` or `codex/phase-9-ux-polish`.

Run tasks sequentially. Each task starts from the current remote head of `codex/architecture-review`, after the prior task PR has merged.

| Order | Task document | Task branch |
|---|---|---|
| 01 | `01-importer-pipeline.md` | `codex/arch-01-importer-contract` |
| 02 | `02-workflow-persistence.md` | `codex/arch-02-persistence-modules` |
| 03 | `03-territory-import-lifecycle.md` | `codex/arch-03-import-lifecycle` |
| 04 | `04-region-setup-workflow.md` | `codex/arch-04-region-workflow` |
| 05 | `05-map-overlay-lifecycle.md` | `codex/arch-05-map-lifecycle` |
| 06 | `06-reconciliation-domain.md` | `codex/arch-06-reconciliation-domain` |

Each task PR targets `codex/architecture-review`. After Task 06 merges, open one final integration PR from `codex/architecture-review` to `codex/phase-9-ux-polish`. Keep that final PR unmerged until its full signed-in browser checkpoint passes and Ben approves the exact head commit.

GitHub Actions currently runs for PRs targeting `main`, not the integration branch. For task PRs, the local `pnpm check` result and reviewer-agent report are the required gates. Do not describe absent GitHub checks as passing. The later PR that brings Phase 9 to `main` remains responsible for the repository's normal GitHub Actions run.

## Resume logic

GitHub and the integration branch are the program ledger. At the start of every orchestrator turn:

1. Fetch `origin`.
2. Inspect the six task branch names and their PRs.
3. Treat a merged task PR as complete only when its merge commit is reachable from `origin/codex/architecture-review`.
4. Resume an open task PR from its remote head. Do not create a second PR or branch for the same task.
5. If a ready PR is waiting for merge authorization, rerun readiness checks and ask the required merge question.
6. Start the next task only after the prior merge is present on the remote integration branch.

If no task PR is open, the first task in the table without a reachable merge is current. Do not repeat merged tasks merely because local branches were deleted.

## Task cycle

Follow this cycle for each task.

### 1. Prepare a clean integration base

Use one clean clone for the orchestration program. The orchestrator runs:

```text
git status --short --branch
git fetch origin
git switch codex/architecture-review
git pull --ff-only origin codex/architecture-review
```

Stop if the clone has unrelated, untracked, uncommitted, or unpushed work. Preserve it. Do not stash, reset, discard, or force-push.

Completion criterion: the clean clone is on the current remote integration head and `git status --short` is empty.

### 2. Compare interface designs

Dispatch three read-only design agents in parallel before implementation. Give each the current task brief, `PRODUCT.md`, and the codebase-design vocabulary below.

- Design A minimizes the interface and aims for one to three entry points.
- Design B optimizes the most common current caller.
- Design C optimizes observable testing and dependency handling.

Each design agent must provide:

1. The interface, including invariants, ordering, errors, configuration, and performance facts callers must know.
2. One current-caller example.
3. The implementation hidden behind the seam.
4. Dependency categories and any justified adapters.
5. The deletion-test result.
6. Files and old exports or tests that the design replaces.

The orchestrator compares the three designs by depth, locality, seam placement, and deletion-test result. Select one design or a small hybrid. Record the decision in the PR body. Do not retain unused alternatives in production code.

Use these terms consistently:

- A **module** has an interface and an implementation.
- The **interface** includes every fact a caller must know.
- A **seam** is where the interface lives.
- An **adapter** is a concrete dependency implementation at a seam.
- **Depth** means that substantial behavior sits behind a small interface.
- **Locality** means one change, bug, or verification path stays in one place.
- The **deletion test** asks where the complexity goes if the module disappears.

Completion criterion: one selected interface has a smaller caller burden than the current code and names every old interface it replaces.

### 3. Dispatch one implementation agent

Give one implementation agent ownership of the complete task diff. Do not split code ownership across concurrent agents. The implementation agent must:

1. Re-read the task brief and selected interface decision.
2. Confirm the integration checkout is still clean and create the task branch named in the program table.
3. Write a focused failing test for the behavior or failure mode named by the task.
4. Replace old interfaces instead of layering wrappers over them.
5. Delete superseded tests and exports after callers move to the new seam.
6. Preserve every task invariant.
7. Run focused checks, then the task's full verification commands.
8. Return the diff summary, commands, results, and remaining concerns.

The implementation agent may make low-impact code decisions. It must stop if the selected interface requires a new product concept, a second production adapter, a provider change, a database replacement, a hardcoded policy threshold, or more scope than the task brief permits.

Completion criterion: the task acceptance criteria pass on one coherent local diff with no unrelated files.

### 4. Verify independently

The orchestrator inspects the entire diff against the integration branch. Re-run every command required by the task. Run these program checks for every task unless the task document adds more:

```text
git diff --check origin/codex/architecture-review...HEAD
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Task 01 owns the current Windows Python launcher failure in the root `pnpm test` command. Before Task 01 fixes it, run the Python suite with an explicit working interpreter and record the exact command. After Task 01, `pnpm test` itself must complete.

For UI-adjacent tasks, run the browser checks named in the task brief. Use a dedicated local port and an isolated database copy or temporary database. Never mutate the canonical founder database, production, or a daily-driver preview. A screenshot is not proof of interaction behavior. Exercise the stated actions and observe their outcomes.

Completion criterion: every required command exits successfully, every manual observation is named, and `git status --short` contains only intended task files.

### 5. Dispatch one reviewer agent

The reviewer agent is read-only. It receives:

- The task brief.
- The selected interface decision.
- The full diff against `origin/codex/architecture-review`.
- Verification output.
- `PRODUCT.md` and relevant implementation-plan sections.

Use an agent that did not edit the task diff. A design agent may review only if it did not produce the selected design.

The reviewer must check:

1. Correctness and failure handling.
2. Product behavior and deterministic output.
3. Module depth, locality, seam placement, and the deletion test.
4. Replacement of old interfaces rather than wrapper layering.
5. Test behavior through the same interface callers use.
6. Church isolation, authentication, validation, and data preservation where relevant.
7. Apartment capability remains disabled and hidden.
8. No provider, infrastructure, or product-scope expansion.
9. No stale comments, dead exports, skipped checks, generated debris, or secrets.

The reviewer returns findings ordered by severity with exact file and line references. No findings is a valid result when the evidence supports it.

Completion criterion: the reviewer reports no unresolved blocking findings on the current head commit.

### 6. Repair with a fixed limit

The implementation agent evaluates each reviewer finding against the task and code. Fix valid in-scope findings, add or adjust tests, and rerun all required checks. The reviewer then checks the new head.

Allow at most two repair-and-review cycles. Stop after the second cycle if blocking feedback remains, repeats, contradicts itself, or requires product judgment. Report `REVIEW LIMIT REACHED` and wait for Ben.

Completion criterion: the current head has no unresolved blocking finding, or the program has stopped at the review limit without merging.

### 7. Publish the task PR

Commit only intended files. Push the task branch and create or update one draft PR targeting `codex/architecture-review`.

Use this PR body:

```markdown
## Why

<task objective and observed problem>

## Interface decision

<selected seam, rejected alternatives, and deletion-test result>

## What changed

<behavior and ownership changes>

## Verification

- `<exact command>`: passed
- Reviewer agent: no blocking findings at `<head-sha>`
- Manual check: <observation, when performed>

## Deferred

<task-owned items deliberately left for Phase 9 or Phase 12>

---
Agent-authored: <model or unknown model> via <harness>, on behalf of Ben Theurich.
```

Do not claim GitHub CI passed when the integration-base PR did not trigger it. Mark the PR ready only after local verification and reviewer-agent approval are current for the pushed head.

Completion criterion: the remote PR head equals the verified and reviewed local head.

### 8. Obtain final merge authorization

Recheck the PR title, base, head SHA, diff, verification, reviewer report, unresolved discussions, and mergeability. Present the readiness summary to Ben and ask exactly:

```text
Merge PR #<number> now?
```

Wait for a new answer. Earlier approval of this orchestration program is not final merge authorization.

After approval, confirm the head SHA is unchanged, squash-merge with head matching, and delete the remote task branch. Keep any local branch that contains uncommitted or unpushed work. Never force-delete it.

Completion criterion: GitHub reports the task PR merged into `codex/architecture-review`, and the next task begins from that merged remote head.

## Program invariants

Every task must preserve these facts:

- Apartments remain disabled through the existing capability seam. Stored apartment code and data remain available for later work.
- No apartment setup, packet, map, progress, or reconciliation behavior becomes visible in the MVP.
- Streetlight remains deterministic and AI-free.
- SQLite remains the only application database.
- The importer stays in the application container.
- WorkOS remains the authentication provider.
- MapLibre and the pinned open-data cartography remain the ordinary map path.
- Google remains limited to the uses approved in `PRODUCT.md`.
- Church data stays isolated by the authenticated workspace scope.
- Coverage history stays append-only and corrections remain explicit.
- Existing transaction atomicity and prior-region preservation remain intact.
- Phase 9 stays at the founder-review checkpoint until Ben completes that checkpoint.

## Final integration gate

After Task 06 merges, update the integration branch and run:

```text
git diff --check origin/codex/phase-9-ux-polish...HEAD
pnpm audit --prod --audit-level low
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Run one signed-in browser regression pass covering:

1. Initial Region Setup and a contained save.
2. Import-required Region Setup, progress polling, refresh reconnection, success, and retry after failure.
3. Exact road selection and map style switching.
4. Coverage search, heatmap settings, and map overlays.
5. Packet proposal, selection, finalization, and PDF download.
6. Reconciliation confirmation, correction, undo, and selected-batch highlighting.
7. Public pilot request validation and duplicate-neutral response.
8. Administrator sign-in, founder-only request review, and church isolation.
9. No visible apartment controls, markers, counts, copy, or mutation access beyond the approved quiet coming-later note.

Run a final read-only reviewer agent over the complete integration diff. Require it to account for all six task briefs and every item in the audit-accounting table below.

Open the final PR from `codex/architecture-review` to `codex/phase-9-ux-polish`. Keep it ready but unmerged until Ben approves the exact final head with the required merge question.

## Audit-accounting table

No audit item may disappear between tasks.

| Audit item | Owning task | Required disposition |
|---|---|---|
| Benchmark crashes on retired `apartmentComplexes` output | 01 | Fix and test the production benchmark path |
| Importer result vocabulary repeated across production and benchmark consumers | 01 | One owned normalized-result seam |
| Root test command fails through the Windows Python launcher shim | 01 | Cross-platform, configurable Python test invocation |
| Four high and two moderate production dependency advisories observed on 2026-08-25 | 01 and 06 | Patch safely in 01, rescan in 06 |
| `database.ts` owns unrelated workflows and outward types | 02 | Replace with workflow-shaped persistence ownership |
| Public pilot route has no request-rate control | 02 | Implement a justified control or record an exact Phase 12 provider control and blocker |
| Territory import transitions leak into route adapters | 03 | One deep persisted lifecycle module |
| Authenticated geocoding has no application quota | 03 | Preserve validation and record the approved Google quota control for Phase 12; add code only when a tested policy needs it |
| Region Setup owns transport, import polling, recovery, draft state, and rendering | 04 | One deep workflow module behind a small interface |
| `StreetlightWorkspace.test.mjs` contains implementation-text assertions | 04, 05, and 06 | Replace behavior claims through real interfaces; delete tests that only preserve syntax |
| Raw MapLibre lifecycle details appear in five overlay callers | 05 | One overlay lifecycle module with production and test adapters |
| Application security headers are absent | 05 | Add and browser-test headers compatible with WorkOS, MapLibre, open tiles, and Google Maps, or block with a concrete incompatibility |
| Coverage-event meaning is reduced twice in reconciliation persistence | 06 | One owned append-only interpretation |
| Biome reports 31 warnings and 4 informational diagnostics | 06 | Fix safe items, add narrow justified suppressions, and reject blanket rule disables |
| Current auth and workspace isolation passed the audit | Every task | Preserve and retest affected routes and transactions |
| Gitleaks found no secret across 255 commits | 06 | Run a final history scan and keep the result in PR evidence |
| Apartments were deliberately deferred | Every task | Keep the single capability disabled; do not reopen apartment optimization |

If a task changes ownership of a later audit item, update the later task brief in the same PR. Do not delete the item from this table.
