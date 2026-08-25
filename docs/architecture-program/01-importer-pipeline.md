# Task 01: Deepen the importer pipeline

## Objective

Restore the geographic benchmark, make the normalized importer result one owned concept, and make the repository's Python verification command work through a configurable cross-platform launcher.

This task also patches the production dependency advisories observed during the architecture audit so later tasks start from a current dependency baseline.

## Program position

- Branch: `codex/arch-01-importer-contract`
- PR base: `codex/architecture-review`
- Depends on: orchestration setup only
- Required next task: Task 02

Follow `ORCHESTRATION.md` for design comparison, implementation ownership, verification, reviewer-agent review, PR publication, and merge authorization.

## Required context

Read:

- `PRODUCT.md`, especially the deterministic importer and benchmark requirements.
- `IMPLEMENTATION_PLAN.md`, especially Phase 2 import evidence and the Phase 9 checkpoint.
- `web/importer/overture_import.py`.
- `web/importer/run_benchmark.py`.
- `web/importer/test_overture_import.py`.
- `web/lib/overture-import.ts` and its tests.
- Root and `web/package.json` plus `pnpm-lock.yaml`.

## Observed defects and pressure

`run_benchmark.py:278-280` reads `normalized["apartmentComplexes"]` and `estimatedTracts`. `normalize_features()` returns `apartmentSites` at `overture_import.py:1750-1753`. A controlled production-path call raises `KeyError: 'apartmentComplexes'`.

The existing benchmark CLI tests replace `run_area()`, so all 69 Python tests pass without exercising the broken projection.

The root `pnpm test` command runs the Node suite and then invokes the ambient `python` command. On the reviewed Windows machine that name resolves first to an inaccessible Windows Store shim. The Python tests pass when invoked through `C:\Users\benth\AppData\Local\Python\bin\python.exe`.

The 2026-08-25 production dependency audit reported four high and two moderate transitive advisories through Next's `sharp`, `postcss`, and `nanoid` dependency paths. Re-run the audit because advisory data and patched versions can change.

## Scope

### Importer ownership

Select an interface that gives one module ownership of the normalized import result used by:

- Production JSON serialization.
- Geographic benchmark projection.
- Benchmark metrics.
- TypeScript process-result validation.
- Tests at each real consumer seam.

Internal Python phases may move into focused files when that increases locality. The external Node-to-Python process interface stays small and deterministic.

Replace repeated output-shape knowledge. Do not add a schema generator, code-generation pipeline, compatibility layer, plugin architecture, or provider abstraction unless two current adapters justify that seam.

### Confirmed benchmark repair

Fix the stale apartment projection. The benchmark may report current `apartmentSites` facts or omit deferred apartment measurements when they no longer describe a valid product metric. Base the decision on the current normalizer contract and `PRODUCT.md`. Do not recreate removed tract estimates or turn apartments on.

Add a test that reaches the real `run_area()` projection with downloaded sources replaced by deterministic in-memory fixtures. The test must fail on the reviewed base and pass after the repair.

### Python test launcher

Make the root verification command honor a configured Python interpreter and work on supported Windows and Unix environments. `STREETLIGHT_PYTHON` is already the production importer override and is the preferred configuration input unless design evidence supports a smaller existing mechanism.

The launcher must:

- Avoid machine-specific absolute paths.
- Fail with a direct message that names the attempted interpreter.
- Preserve Python unittest exit status and output.
- Keep the normal zero-configuration path for machines with a usable Python command.

### Dependency maintenance

Run `pnpm audit --prod --audit-level low`. Apply the smallest compatible package or lockfile update that removes current production advisories. Do not run a forced audit fix, accept a major framework upgrade, or add overrides without checking the affected package's supported range.

If no compatible patch exists, stop this subtask and report the advisory, installed path, proposed change, and product risk. Do not hide the result with an audit exception.

## Required invariants

- The importer remains deterministic and AI-free.
- The pinned Overture release and normalizer behavior remain unchanged except for contract ownership and a proven defect repair.
- Existing address, road, building, FEMA fallback, and quality metrics remain byte-for-byte or value-for-value equivalent for fixed fixtures.
- Apartments remain disabled in the MVP.
- The production Python process output stays acceptable to the TypeScript validator.
- Benchmark failures still name the failed quality metrics and return an unsuccessful process status.
- No live benchmark result or threshold is fabricated when provider access is unavailable.

## Acceptance criteria

1. A focused test reproduces the old `KeyError` through `run_area()` and passes after the fix.
2. Production serialization and benchmark projection consume the same owned normalized-result concept.
3. Old apartment result names disappear from active importer and benchmark code.
4. The TypeScript adapter accepts the repaired production output and rejects malformed legacy output.
5. Root `pnpm test` completes when `STREETLIGHT_PYTHON` names a working interpreter.
6. A missing configured interpreter produces one direct failure before partial Python execution.
7. All existing importer quality and deterministic-output tests pass.
8. The production dependency audit reports no unresolved advisory at the required severity, or the PR is blocked with the exact incompatible upgrade decision.
9. No apartment UI, route access, packet behavior, or stored-data semantics change.

## Focused verification

Use exact paths available in the execution environment.

```text
<python> -m unittest web.importer.test_overture_import
<python> -m unittest <new run_area integration test> -v
pnpm --dir web exec node --test lib/overture-import.test.ts
pnpm audit --prod --audit-level low
pnpm test
```

Then run every program check from `ORCHESTRATION.md`.

Run the real five-area benchmark with its pinned cache when the cache is available and current. If it requires a new external download, record the command, provider, cache path, and result. A network failure blocks live-benchmark evidence but does not justify changing thresholds or fixtures.

## Reviewer focus

The reviewer must answer:

- Does one module own normalized-result meaning, or did the change add another wrapper?
- Does the new test cross the production benchmark projection instead of replacing it?
- Can the production process and benchmark drift again without a failing test?
- Did the dependency repair preserve the pinned framework major version and deterministic build?
- Does the Python launcher use configuration rather than a developer-specific path?
- Did any apartment metric or behavior return by accident?

## Excluded work

- Apartment detection or tract estimation changes.
- New import providers.
- Benchmark threshold changes.
- Import performance tuning unrelated to result ownership.
- Territory job orchestration, which belongs to Task 03.

## Completion evidence

The PR must include:

- The old controlled `KeyError` reproduction.
- The selected interface decision and deletion-test result.
- Focused Python and TypeScript commands.
- Root `pnpm test` result with the interpreter path source named.
- Production dependency audit output.
- Live benchmark result or the exact external-access blocker.
