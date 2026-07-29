# Overture / NAD normalizer v9 benchmark

Run on July 29, 2026 against Overture release `2026-06-17.0` and the USDOT
National Address Database using the five fixed holdout territories in
`web/importer/run_benchmark.py`.

Normalizer v9 separates probable apartment complexes before evaluating street counts. Explicit
apartment buildings without unit evidence use a conservative gross-floor-area estimate based on
their footprint and Overture floor/height fields. The reference oracle deduplicates repeated NAD
points by canonical street, complete house number, and postcode. A reference premise matching a
detected apartment address is excluded from the street-count metric.

| Territory | Street assignment | Road representation | Correct road names | Segment counts | Severe misses | Apartment complexes / est. tracts | Result |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Sacramento suburban | 94.88% | 100% | 97.78% | 93.70% (253/270) | 5 | 16 / 363 | Fail |
| Boston urban | 97.93% | 100% | 100% | 86.52% (77/89) | 2 | 453 / 7,511 | Fail |
| Austin residential | 96.17% | 100% | 98.15% | 97.59% (162/166) | 0 | 0 / 0 | Pass |
| Lehi newer development | 91.17% | 100% | 92.86% | 96.73% (148/153) | 0 | 0 / 0 | Fail |
| Ames small city | 94.10% | 100% | 96.77% | 100% (113/113) | 0 | 21 / 1,484 | Fail |

Acceptance remains at least 95% street-address assignment, 99% road representation, 98% correct
road names, 90% segment-count accuracy, and zero severe misses. One of five holdouts passes every
threshold. Every holdout represents all measured roads; the remaining failures are address
assignment, naming, or localized segment estimates rather than missing road geometry.

The benchmark now exposes literal problem locations. The seven severe misses are five Sacramento
segments and two Boston segments:

- Sacramento: four Elk Grove Boulevard segments and one unnamed road near
  `-121.3669149, 38.3903025`.
- Boston: Boylston Street source `5277f842-bcb2-4faa-931b-cfc728788e9b` near
  `-71.0890473, 42.3468305`, and Massachusetts Avenue source
  `fe695f88-6b03-49db-a06d-e7bff3af37f3` near `-71.0869171, 42.3456264`.

The machine-readable result also records each segment ID, competing nearby names, expected
premises, estimated tracts, and duplicate-point evidence.

## Interpretation

This is a conservative quality gate, not apartment ground truth. NAD does not reliably identify
residential versus commercial premises and does not provide a nationwide authoritative unit
count. The apartment totals above therefore prove deterministic detection and street
double-count prevention; they do not independently validate every complex's estimated tracts.

No holdout-specific correction was added. The next meaningful quality improvement requires a
better licensed nationwide/global address or building source, or a new residential-use oracle.
Adding more distance/name heuristics would tune the importer to these five areas without resolving
the missing source evidence.
