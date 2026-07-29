# Overture / NAD normalizer v7 benchmark

Run on July 29, 2026 against Overture release `2026-06-17.0` and the USDOT
National Address Database. The benchmark used the five fixed territories in
`web/importer/run_benchmark.py`.

```powershell
python -m importer.run_benchmark --area all
```

| Territory | Address assignment | Road representation | Correct road names | Segment counts | Severe outliers | Result |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Sacramento suburban | 94.77% | 100% | 97.78% | 87.11% (250/287) | 14 | Fail |
| Boston urban | 98.40% | 100% | 100% | 87.00% (87/100) | 3 | Fail |
| Austin residential | 96.17% | 100% | 98.15% | 98.19% (163/166) | 0 | Pass |
| Lehi newer development | 91.17% | 100% | 92.86% | 96.71% (147/152) | 0 | Fail |
| Ames small city | 93.77% | 100% | 96.77% | 95.80% (114/119) | 3 | Fail |

Acceptance requires at least 95% address assignment, 99% road representation,
98% correct road names, 90% segment-count accuracy, and zero unflagged severe
outliers. Austin passed every threshold. The complete five-area benchmark
failed because the other four territories missed one or more thresholds.

The failure is actionable rather than silent: normalizer v7 persists its
source counts and concrete quality warnings, and administrators may continue
with a prominent warning. Per the approved product rule, Streetlight stops
adding address-matching heuristics here. The next data-quality investigation
is a licensed nationwide or global address source.
