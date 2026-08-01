# Overture / FEMA building-selection v11 benchmark

Run on August 1, 2026 against Overture release `2026-06-17.0`, FEMA USA Structures,
and the five fixed benchmark territories in `web/importer/run_benchmark.py`.

The benchmark calls the same `select_map_buildings()` function used by territory imports. It
reports Overture footprints retained plus FEMA structures accepted by either the direct address-gap
rule or the founder-approved same-side row-gap rule.

| Territory | Raw Overture | Raw FEMA | Direct FEMA | Row-gap FEMA | FEMA resolved | Selected total | Classification |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Sacramento suburban | 1,937 | 1,649 | 11 | 0 | 11 | 1,948 | Usable with warnings |
| Boston urban | 810 | 99 | 0 | 0 | 0 | 810 | Usable with warnings |
| Austin residential | 1,706 | 1,351 | 2 | 0 | 2 | 1,708 | High confidence |
| Lehi newer development | 1,089 | 809 | 2 | 0 | 2 | 1,091 | Usable with warnings |
| Ames small city | 1,005 | 813 | 2 | 1 | 3 | 1,008 | Usable with warnings |

These five-area counts are drift evidence, not accuracy claims: the individual FEMA structures in
those holdouts have not been manually classified. They prove that the benchmark exercises the
production selector and exposes changes in each selection path.

## Founder-reviewed accuracy gate

The separate Temecula audit replays the 50 real FEMA candidates reviewed by the founder against
14,500 pinned Overture footprints. Eleven candidates are approved ground truth and 39 are rejected.

| Reviewed | Expected | Selected | True positives | False positives | False negatives | Precision | Recall |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 50 | 11 | 11 | 11 | 0 | 0 | 100% | 100% |

All 11 recoveries came through the row-gap rule. Any future false positive or false negative makes
the benchmark command fail. The existing street and tract metrics were calculated unchanged and
retained their prior classifications.
