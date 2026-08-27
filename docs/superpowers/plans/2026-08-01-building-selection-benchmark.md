# Building Selection Benchmark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the production Overture/FEMA building selector in the benchmark, report FEMA recovery counts, and gate it against the founder-reviewed Temecula sample.

**Architecture:** `select_map_buildings()` remains the single selection implementation and optionally returns decision counts for benchmark callers. The five existing holdouts cache FEMA alongside their existing sources. A separate Temecula audit uses pinned Overture sources plus a compact fixture of the 50 reviewed real FEMA candidates.

**Tech Stack:** Python standard library, `unittest`, existing Overture/FEMA/NAD downloaders.

## Global Constraints

- Use real Overture and FEMA geometry; do not add mock or guessed buildings.
- Existing street and tract benchmark metrics remain unchanged.
- Unreviewed five-area building counts are drift evidence, not accuracy claims.
- The Temecula audit must remain 11 accepted, 39 rejected, with 100% precision and recall.
- Add no dependency or production provider.

---

### Task 1: Production selection metrics and FEMA cache

**Files:**
- Modify: `web/importer/test_overture_import.py`
- Modify: `web/importer/overture_import.py`
- Modify: `web/importer/run_benchmark.py`

**Interfaces:**
- Consumes: `select_map_buildings(addresses, overture_buildings, fema_buildings, roads)`.
- Produces: optional `include_metrics=True` return `(buildings, metrics)` and five-area `buildingSelection` output.

- [x] **Step 1: Write failing tests**

Add a selector test with one direct fallback and one approved row gap, asserting:

```python
selected, metrics = select_map_buildings(
    addresses, overture, fema, roads, include_metrics=True
)
self.assertEqual(metrics, {
    "rawOvertureBuildings": 2,
    "rawFemaStructures": 2,
    "selectedOvertureBuildings": 2,
    "directFemaGapFills": 1,
    "rowGapFemaGapFills": 1,
    "femaResolvedBuildings": 2,
    "selectedMapBuildings": 4,
})
```

Extend the cache test so `download_fema_features` runs once and the cached return value contains
roads, addresses, Overture buildings, NAD reference points, and FEMA structures.

- [x] **Step 2: Verify RED**

Run:

```powershell
python -m unittest importer.test_overture_import.NormalizeFeaturesTest.test_map_building_metrics_separate_direct_and_row_gap importer.test_overture_import.BenchmarkMetricsTest.test_benchmark_cache_reuses_the_exact_downloaded_sources -v
```

Expected: the selector rejects `include_metrics` and the cache returns only four source groups.

- [x] **Step 3: Implement the minimum shared metrics**

Track direct and row-gap IDs inside `select_map_buildings()`. Preserve its existing list return by
default; only `include_metrics=True` returns the tuple. Replace legacy version-3 caches because they
lack complete Overture map footprints. Extend version-4 `load_sources()` to fill and persist a
missing `fema` key without redownloading its valid Overture or NAD data. Make `run_area()` call the
metric-returning selector and emit the returned dictionary as `buildingSelection`.

- [x] **Step 4: Verify GREEN**

Run the two focused tests and the complete Python importer suite.

---

### Task 2: Founder-reviewed Temecula accuracy gate

**Files:**
- Create: `web/importer/benchmark_fema_audit.json`
- Modify: `web/importer/test_overture_import.py`
- Modify: `web/importer/run_benchmark.py`
- Create: `docs/benchmarks/2026-08-01-building-selection-v11.md`
- Modify: `IMPLEMENTATION_PLAN.md`

**Interfaces:**
- Consumes: production `select_map_buildings(..., include_metrics=True)` and the 50 reviewed source IDs/geometries.
- Produces: top-level `buildingAudit` with counts, precision, recall, and ID-level errors.

- [x] **Step 1: Write failing audit test**

Use a small real-code selection result to assert the accuracy calculation:

```python
result = benchmark_module.audit_metrics(
    selected_ids={"accepted", "false-positive"},
    expected_ids={"accepted", "missed"},
    reviewed_ids={"accepted", "false-positive", "missed"},
)
self.assertEqual(result["truePositives"], 1)
self.assertEqual(result["falsePositiveIds"], ["false-positive"])
self.assertEqual(result["falseNegativeIds"], ["missed"])
self.assertEqual(result["precision"], 0.5)
self.assertEqual(result["recall"], 0.5)
```

Extend the CLI test so a false positive or missing reviewed candidate makes `main()` return false.

- [x] **Step 2: Verify RED**

Run the two focused audit tests. Expected: `audit_metrics` and the audit gate do not exist.

- [x] **Step 3: Add the compact real-data fixture and audit runner**

Filter the former founder audit to its 50 `addressed_suppressed` candidates. Store only center,
radius, source ID, geometry, and accepted boolean. Load or cache the pinned Temecula Overture
roads/addresses/buildings, convert fixture candidates to FEMA Single Family Dwelling inputs, call
the production selector, and compare selected reviewed IDs with the 11 approved IDs.

- [x] **Step 4: Verify GREEN and run the real benchmark**

Run the focused tests, all 60+ Python tests, then:

```powershell
python -m importer.run_benchmark --area all --cache-dir C:\Users\benth\Documents\Coding\Streetlight\tmp\benchmark-cache-v9
```

Record all five `buildingSelection` summaries and the Temecula precision/recall result in the new
benchmark report. Update Phase 9 evidence with exact check counts.

- [x] **Step 5: Complete repository verification**

Run Node tests, Biome, TypeScript, production build, and `git diff --check`.
