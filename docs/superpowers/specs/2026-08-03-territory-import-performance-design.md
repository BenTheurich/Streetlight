# Territory import performance design

Status: founder approved direction; written-spec review pending

Date: 2026-08-03

## Goal

Make initial and expanded territory imports feel reliable and finish in a practical amount of time
without changing Streetlight's deterministic geography, reviewed matching rules, or failure safety.
A typical one-to-two-mile territory should finish in about two minutes under ordinary network
conditions. Streetlight will support territory distances up to five miles.

## Measured problem

The founder territory's version-11 refresh exceeded the current 15-minute request timeout while
the Python normalizer remained CPU-bound. Its saved version-10 dataset contains about 44,222 street
segments, 68,911 assigned addresses, and 14,592 displayed buildings.

The importer currently performs repeated full-list scans while matching addresses, road segments,
Overture buildings, and FEMA structures. At founder-territory scale, those nested scans can require
billions of candidate comparisons. The synchronous territory request then hides all intermediate
work and kills the importer at 15 minutes, even though it is still making progress.

## Approved direction

Streetlight will optimize the existing deterministic Python normalizer and run imports as
recoverable background jobs with truthful stage-based progress. It will not rewrite the reviewed
matching behavior, add a separate worker service, or introduce a regional data cache in this pass.

The Setup distance control and server validation will cap territory distance at five miles. The
two-minute target applies to typical one-to-two-mile territories, not as a promise that every dense
five-mile territory will finish in two minutes.

## Importer optimization

The importer will reduce candidate sets before applying its existing exact rules:

- Index named road segments by canonical street name and compatible street-name core.
- Use deterministic in-memory spatial buckets for nearby road segments, addresses, Overture
  buildings, and FEMA structures.
- Insert a feature into every bucket touched by its bounding box so candidates near cell edges are
  not lost.
- Apply the current geometric distance, name compatibility, ambiguity margin, row-gap, apartment,
  and fallback-home rules to the filtered candidates. Candidate filtering must not change a
  reviewed result.
- Cache geometry bounds, centers, areas, and other repeatedly calculated values for the duration of
  one import.
- Find the nearest and second-nearest candidates in one pass instead of sorting a complete
  candidate collection when only ambiguity and distance are needed.

The implementation will remain in the existing Python importer and use the standard library plus
the already-required DuckDB runtime. Moving all matching into spatial SQL is deferred because it
would rewrite nuanced, benchmarked behavior rather than only accelerating candidate discovery.

## Background job flow

When a save can reuse the stored import footprint, it remains an ordinary fast territory save.
Only a new footprint, expanded footprint, or required source-contract upgrade creates an import
job.

The application will persist one active import job per church and return control to the browser
after the job is accepted. The job stores the immutable territory draft it is importing, current
stage, timestamps, outcome, and a safe failure reason. A repeated submission for the same draft
reconnects to the existing job rather than starting duplicate work.

The importer will report these coarse stages:

1. Downloading streets and addresses
2. Downloading building footprints
3. Matching homes to streets
4. Preparing territory data
5. Saving territory

These are stage labels, not synthetic percentages. The application records stage changes and a
heartbeat while the importer runs. A page refresh reconnects to the persisted job.

For a new church, Setup remains the only available tool until the first import succeeds. The page
shows the current stage, explains that setup usually takes around two minutes, and may be safely
refreshed. For an expansion or required upgrade, the last saved territory remains fully usable;
the administrator may leave Setup and sees a compact import status until the replacement is ready.
Territory editing is locked while that immutable draft is importing, but other tools remain usable.

On success, Streetlight validates the complete importer result and replaces the imported territory
inside one atomic database transaction while preserving coverage history and applicable manual
segment decisions. On failure or interruption, the active territory remains unchanged and the job
offers a retry. An interrupted application process is reported as interrupted rather than left
indefinitely running.

## Performance and correctness evidence

Stage timings and source/candidate counts will be recorded for local diagnostics without exposing
resident-level data. Verification will include:

- The existing Python importer and geographic benchmark suite remains unchanged in its expected
  normalized output, including the founder-approved FEMA holdouts.
- Focused checks prove spatial-bucket boundary cases return the same candidates as exhaustive
  matching and preserve nearest/ambiguity decisions.
- A production-equivalent founder-territory import records total and per-stage time and targets an
  ordinary end-to-end duration of about two minutes.
- A representative five-mile rural import completes successfully without an HTTP-request timeout.
- New-territory, expansion, refresh/reconnect, duplicate-submit, process-interruption, retry, and
  atomic-failure checks preserve the previous saved territory until success.
- Client and server validation both reject distances above five miles.

If the optimized founder-territory normalization remains too slow, profiling will identify the
remaining measured hotspot before another architectural change. Regional tiles, incremental
expansion merging, and preprocessed shared caches remain deferred until benchmarks show they are
needed.

## Deliberate exclusions

This work will not add Redis, a separate worker deployment, PostgreSQL, regional source-data
caches, synthetic progress percentages, incremental annulus imports, or a DuckDB rewrite of the
normalizer. Raising the existing synchronous timeout alone is not an acceptable fix.
