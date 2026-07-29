# Benchmark quality tiers

Approved in conversation by the founder on July 29, 2026.

## Purpose

Streetlight's geographic benchmark distinguishes data that is usable for the pilot from data that
meets the project's stricter quality target. This prevents a handful of localized source errors
from blocking the product while keeping every limitation visible.

The benchmark is a development and release-quality gate. It does not prevent an administrator from
using an imported territory. Runtime territories continue to show persistent, concrete quality
warnings when they do not meet the high-confidence thresholds.

## Classifications

A holdout is **high confidence** only when it meets every original threshold:

| Metric | High-confidence threshold |
| --- | ---: |
| Address assignment | At least 95% |
| Road representation | At least 99% |
| Correct road names | At least 98% |
| Segment-count accuracy | At least 90% |
| Severe outliers | Zero |

A holdout is **usable with warnings** when it misses at least one high-confidence threshold but
meets every usable floor:

| Metric | Usable floor |
| --- | ---: |
| Address assignment | At least 90% |
| Road representation | At least 99% |
| Correct road names | At least 90% |
| Segment-count accuracy | At least 85% |
| Severe outliers | No more than 3% of evaluated segments |

A holdout is **below the usable floor** when it misses any usable threshold. That result blocks the
global pipeline's release-quality gate and requires investigation of source data or a broadly
applicable normalization defect. It does not silently disable an existing church workspace.

Threshold comparisons are inclusive. The severe-outlier rate is the number of severe outlier
segments divided by evaluated segments.

## Suite-level rule

The pinned global pipeline is acceptable for the pilot when every fixed holdout is at least usable
with warnings. High confidence remains the improvement target rather than the minimum release
condition.

The benchmark report records the literal measurements, both classifications, failed metrics, and
problem locations. It must not hide a miss by rounding its displayed value.

Under normalizer v9, Austin is high confidence. Sacramento, Boston, Lehi, and Ames are usable with
warnings. All five represent 100% of measured residential roads.

## Scope

This decision changes benchmark classification, documentation, and the Phase 2 completion gate.
It does not change importing, address assignment, street geometry, tract estimates, runtime warning
behavior, packet generation, or geographic providers.

No holdout-specific heuristic is permitted merely to improve a benchmark classification.

## Verification

Automated checks cover exact threshold boundaries, high-confidence results, usable-with-warning
results, below-floor results, and suite-level acceptance. The refreshed five-area report must show
one high-confidence and four usable-with-warning holdouts with the unchanged literal metrics.
