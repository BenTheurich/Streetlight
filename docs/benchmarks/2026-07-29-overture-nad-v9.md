# Overture / NAD normalizer v9 benchmark

Run on July 29, 2026 against Overture release `2026-06-17.0` and the USDOT
National Address Database using the five fixed holdout territories in
`web/importer/run_benchmark.py`.

Normalizer v9 separates probable apartment complexes before evaluating street counts. Explicit
apartment buildings without unit evidence use a conservative gross-floor-area estimate based on
their footprint and Overture floor/height fields. The reference oracle deduplicates repeated NAD
points by canonical street, complete house number, and postcode. A reference premise matching a
detected apartment address is excluded from the street-count metric.

| Territory | Street assignment | Road representation | Correct road names | Segment counts | Severe misses | Apartment complexes / est. tracts | Classification |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Sacramento suburban | 94.88% | 100% | 97.78% | 93.70% (253/270) | 5 | 16 / 363 | Usable with warnings |
| Boston urban | 97.93% | 100% | 100% | 86.52% (77/89) | 2 | 453 / 7,511 | Usable with warnings |
| Austin residential | 96.17% | 100% | 98.15% | 97.59% (162/166) | 0 | 0 / 0 | High confidence |
| Lehi newer development | 91.17% | 100% | 92.86% | 96.73% (148/153) | 0 | 0 / 0 | Usable with warnings |
| Ames small city | 94.10% | 100% | 96.77% | 100% (113/113) | 0 | 21 / 1,484 | Usable with warnings |

High confidence retains the original thresholds: at least 95% street-address assignment, 99% road
representation, 98% correct road names, 90% segment-count accuracy, and zero severe misses. The
pilot usable floor is 90%, 99%, 90%, 85%, and no more than 3% severe misses respectively. Every
holdout is at least usable and represents all measured roads. The warnings concern address
assignment, naming, or localized segment estimates rather than missing road geometry.

The benchmark now exposes literal problem locations. The seven severe misses are five Sacramento
segments and two Boston segments:

- Sacramento: four Elk Grove Boulevard segments and one unnamed road near
  `-121.3669149, 38.3903025`. Five of 270 evaluated segments are severe outliers (1.85%).
- Boston: Boylston Street source `5277f842-bcb2-4faa-931b-cfc728788e9b` near
  `-71.0890473, 42.3468305`, and Massachusetts Avenue source
  `fe695f88-6b03-49db-a06d-e7bff3af37f3` near `-71.0869171, 42.3456264`. Two
  of 89 evaluated segments are severe outliers (2.25%).

The machine-readable result also records each segment ID, competing nearby names, expected
premises, estimated tracts, and duplicate-point evidence.

## Interpretation

This is a conservative quality gate, not apartment ground truth. NAD does not reliably identify
residential versus commercial premises and does not provide a nationwide authoritative unit
count. The apartment totals above therefore prove deterministic detection and street
double-count prevention; they do not independently validate every complex's estimated tracts.

No holdout-specific correction was added. The pipeline meets the founder-approved pilot gate while
retaining every literal miss and problem location. A future improvement beyond the current
high-confidence rate requires a better licensed nationwide/global address or building source, or a
new residential-use oracle. Adding more distance/name heuristics would tune the importer to these
five areas without resolving the missing source evidence.
