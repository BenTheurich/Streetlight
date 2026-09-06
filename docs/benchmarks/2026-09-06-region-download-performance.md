# Region download performance, September 6, 2026

The two changes preserve imported data, but the measured end-to-end gain varies with provider
response times. The reversed one-mile pair improved by 1.51 seconds, or 1.1%. Larger reductions
in the other pairs mostly reflect faster Overture responses. The remaining wait is dominated by
Overture road and building downloads.

The `speed-up-region-downloads` worktree changes two parts of the production importer:

- FEMA downloads start in one background thread while Overture downloads run on the main thread.
  Matching begins after both finish. A FEMA service failure retains the existing Overture-only
  fallback.
- Roads, addresses, buildings, and apartment boundaries share one DuckDB connection. The
  standalone source downloads used by the geographic benchmark still open and close their own
  connection.

The Overture release remains `2026-08-19.0`, DuckDB remains `1.5.5`, and the normalizer remains
version 12. SQL projections, geographic filters, matching rules, output shape, and database
replacement are unchanged. Region expansion still imports the complete enlarged footprint.

## Live measurements

| Radius | Pair | Baseline seconds | Modified seconds | Observed reduction |
|---|---:|---:|---:|---:|
| 1 mile | 1 | 178.49 | 129.82 | 48.67 seconds, 27.3% |
| 1 mile | 2, reversed order | 142.13 | 140.62 | 1.51 seconds, 1.1% |
| 1.9 miles | 1 | 283.26 | 158.88 | 124.37 seconds, 43.9% |

All four one-mile samples have matching complete payload hashes after removing only `completedAt`.
They contain 2,313 segments, 53 apartment sites, and 7,343 map buildings. The two expanded samples
also match, with 7,013 segments, 111 apartment sites, and 18,549 map buildings. Collection order
and geometry coordinates remain part of these comparisons.

The total-time difference includes network variation. In the first one-mile pair, Overture
downloads fell from about 168.0 to 128.9 seconds, even though their SQL and sequencing stayed the
same. The baseline paid 9.58 seconds for FEMA after Overture finished. The modified run completed
FEMA in 14.26 seconds entirely during Overture downloads. Connection setup took about 0.1 seconds.
The source timings support overlapping FEMA; they do not attribute the entire observed reduction
to these code changes.

In the expanded comparison, roads took 128.05 seconds before the interruption and 35.00 seconds
in the modified run afterward. FEMA took 10.70 seconds at the end of the baseline, then 37.63
seconds overlapping Overture in the modified run.

In the reversed one-mile pair, baseline Overture work took 137.12 seconds and modified Overture
work took 139.69 seconds. FEMA's 3.99-second wait in the baseline became a 4.20-second concurrent
download in the modified run, leaving a net observed reduction of 1.51 seconds.

Across the baseline samples, FEMA added 3.99 to 10.70 seconds after Overture. The modified pipeline
overlaps that source work with Overture. Reusing the connection removes about 0.1 seconds of
setup in these samples. A stable overall speedup percentage is not established by this small,
variable set of live runs.

## Measurement method

The baseline importer comes from commit `7256775`. Baseline and modified importers run in separate
fresh Python 3.14.4 processes on the same machine. Each sample downloads the same public Sacramento
test region centered at longitude `-121.3716`, latitude `38.4088`, at either one or 1.9 miles.
The larger radius exercises the import performed when an existing region expands.

Each run records source durations, feature counts, full importer time through JSON output, and
payload hashes excluding `completedAt`. Database writes, application startup, and browser rendering
are outside these measurements. No church database or preview server participates.

Runs execute sequentially to avoid competing for bandwidth. The repeated one-mile pair reverses
the baseline/candidate order. DuckDB extensions are already installed; each process creates its own
database connection and in-memory cache. Upstream caching and network conditions are not controlled.
The documented Git CA bundle supplies `SSL_CERT_FILE` without disabling certificate verification.

The application interruption stopped the first modified 1.9-mile sample before it produced a
payload. That incomplete run is excluded. Its replacement runs after the interruption, so the
expanded-region comparison also includes a gap between baseline and modified measurements.

The local runner, source snapshots, payloads, and timing records live in
`tmp/import-download-benchmark/` inside this worktree. The runner accepts `--variant baseline` or
`--variant candidate`, `--radius`, and a distinct `--run` label. These files are ignored by Git.

## Verification

- `pnpm check` passes after updating the branch to main commit `ab7243b`: lint, type checking,
  397 application checks, four Python-launcher checks, 73 importer checks, and the production build.
- The new checks prove download overlap and connection reuse, including closure after extension
  initialization, road-query, and apartment-query failures.
- The complete CLI output matches the baseline on all six historical cached source fixtures after
  removing only `completedAt`. This comparison uses fixed inputs and does not claim a current
  geographic quality benchmark.
- A focused independent review found no blocking correctness or cleanup issue.

An early Overture failure waits for the concurrent FEMA download to finish before the executor
closes. The existing importer process timeout remains in place. This change does not add a worker
service or cancellation protocol.
