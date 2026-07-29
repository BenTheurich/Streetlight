# Benchmark Quality Tiers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Classify each geographic holdout as high confidence, usable with warnings, or below the usable floor, and use the usable floor as the pilot release gate.

**Architecture:** Keep literal metric calculation in `benchmark_metrics`, add one deterministic classification helper beside it, and make the benchmark CLI accept a suite only when every holdout is at least usable. Update the product authority, roadmap, and existing v9 report without changing imports or runtime territory behavior.

**Tech Stack:** Python standard library and `unittest`; Markdown product and benchmark documentation.

## Global Constraints

- High confidence requires 95% address assignment, 99% road representation, 98% correct names, 90% segment-count accuracy, and zero severe outliers.
- Usable requires 90% address assignment, 99% road representation, 90% correct names, 85% segment-count accuracy, and no more than 3% severe outliers.
- Threshold comparisons are inclusive.
- Every fixed holdout must be at least usable for the pilot release gate to pass.
- Do not change importer behavior, source providers, estimates, runtime warnings, or packet generation.
- Do not add a holdout-specific heuristic.

---

### Task 1: Deterministic benchmark classification

**Files:**
- Modify: `web/importer/overture_import.py`
- Modify: `web/importer/run_benchmark.py`
- Test: `web/importer/test_overture_import.py`

**Interfaces:**
- Produces: `benchmark_classification(address_assignment_rate, road_representation_rate, road_name_accuracy, segment_count_accuracy, severe_outliers, evaluated_segments) -> dict`
- Adds to benchmark output: `severeOutlierRate`, `highConfidenceFailedMetrics`, `usableFailedMetrics`, and `classification`
- Classification values: `high_confidence`, `usable_with_warnings`, `below_usable_floor`

- [x] **Step 1: Write failing boundary and suite-gate tests**

Test the helper at the exact high-confidence boundaries, at the exact usable boundaries including
3% severe outliers, and immediately below each usable floor. Update the literal-result test to
expect the four new fields instead of `failedMetrics` and `passed`. Add a CLI test that stubs one
high-confidence and one usable holdout and expects `main()` to return `True`, then changes one to
`below_usable_floor` and expects `False`.

- [x] **Step 2: Run the focused tests and verify failure**

Run:

```powershell
..\tmp\benchmark-venv\Scripts\python.exe -m unittest importer.test_overture_import.BenchmarkMetricsTest -v
```

Expected: failure because the classification helper and new output fields do not exist.

- [x] **Step 3: Implement the minimum classification helper**

Calculate `severeOutlierRate` as `severe_outliers / evaluated_segments`, or zero when no segments
were evaluated. Build the two failed-metric lists with inclusive thresholds, then return:

```python
{
    "severeOutlierRate": severe_rate,
    "highConfidenceFailedMetrics": high_confidence_failures,
    "usableFailedMetrics": usable_failures,
    "classification": (
        "high_confidence"
        if not high_confidence_failures
        else "usable_with_warnings"
        if not usable_failures
        else "below_usable_floor"
    ),
}
```

Merge that result into `benchmark_metrics`. Remove the ambiguous `failedMetrics` and `passed`
fields. Make `run_benchmark.main()` return true when no area is `below_usable_floor`.

- [x] **Step 4: Run the complete importer suite**

Run:

```powershell
..\tmp\benchmark-venv\Scripts\python.exe -m unittest importer.test_overture_import -v
```

Expected: all importer tests pass.

### Task 2: Product authority and benchmark evidence

**Files:**
- Modify: `PRODUCT.md`
- Modify: `IMPLEMENTATION_PLAN.md`
- Modify: `docs/benchmarks/2026-07-29-overture-nad-v9.md`

**Interfaces:**
- Consumes: the three classification values and literal v9 metrics from Task 1
- Produces: the approved product rule and Phase 2 completion evidence

- [x] **Step 1: Update the product authority**

Replace the single pass/fail benchmark rule with the approved two-tier thresholds. State that every
fixed holdout must be at least usable for the pilot, high confidence remains the improvement
target, and runtime warnings remain visible.

- [x] **Step 2: Update the v9 report without rerunning source downloads**

Keep every literal v9 metric unchanged. Label Austin `High confidence`; label Sacramento, Boston,
Lehi, and Ames `Usable with warnings`. Record Sacramento's severe-outlier rate as `5 / 270 =
1.85%` and Boston's as `2 / 89 = 2.25%`.

- [x] **Step 3: Mark Phase 2 complete**

Change the Phase 2 roadmap row from `Blocked` to `Complete` and cite the two-tier rule, five usable
holdouts, 100% measured-road representation, automated checks, and unchanged runtime warnings.

- [x] **Step 4: Run final verification**

Run:

```powershell
..\tmp\benchmark-venv\Scripts\python.exe -m unittest importer.test_overture_import -v
npm.cmd test
npm.cmd run lint
npm.cmd run typecheck
git diff --check
```

Expected: all checks pass and the working tree contains only the intended benchmark-tier changes.

- [x] **Step 5: Commit**

```powershell
git add PRODUCT.md IMPLEMENTATION_PLAN.md docs/benchmarks/2026-07-29-overture-nad-v9.md web/importer/overture_import.py web/importer/run_benchmark.py web/importer/test_overture_import.py docs/superpowers/plans/2026-07-29-benchmark-quality-tiers.md
git commit -m "feat: classify usable benchmark quality"
```
