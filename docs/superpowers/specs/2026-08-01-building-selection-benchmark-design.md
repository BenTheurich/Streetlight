# Building-selection benchmark design

**Approved:** 2026-08-01

## Goal

Make the benchmark exercise Streetlight's production Overture/FEMA building-selection code and
report how many displayed footprints FEMA resolves. Preserve the existing street and tract quality
benchmark unchanged.

## Execution metrics

For each of the five existing U.S. holdouts, load real Overture roads, addresses, and buildings plus
real FEMA USA Structures, then call the same `select_map_buildings()` function used by territory
imports. Report:

- raw Overture buildings;
- raw FEMA structures examined;
- selected Overture buildings;
- direct FEMA gap fills, where no Overture footprint is within 10 meters of the matched address;
- FEMA row-gap fills, where an Overture footprint suppressed the direct fallback and the approved
  same-side row-gap rule accepted the FEMA structure;
- total FEMA-resolved footprints and total selected map buildings.

These five-area counts are drift evidence, not accuracy claims, because those structures have not
been manually classified.

## Accuracy gate

Keep a compact benchmark fixture for the 50 real Temecula addressed FEMA candidates reviewed by
the founder: 11 accepted and 39 rejected. Run those actual geometries through
`select_map_buildings()` with the pinned Overture sources for the saved Temecula territory. Report
reviewed candidates present, true positives, false positives, false negatives, precision, and
recall. The benchmark exits unsuccessfully if any reviewed candidate is missing or if precision or
recall falls below 100 percent.

The fixture contains real source IDs, geometries, and founder classifications. It does not contain
mock buildings or satellite-derived guesses.

## Cache and failures

Cache the complete Overture, NAD, and FEMA inputs per area. Legacy version-3 caches are invalid for
this benchmark because they retained only residential-classified Overture buildings rather than
the complete production footprint layer; replace them once with version 4. A version-4 cache that
is missing only FEMA triggers only the FEMA download. Invalid provider responses fail the benchmark
explicitly rather than silently reporting zero structures.

The founder-audit Overture snapshot uses its own cache version because its dedicated cache has
always contained the complete footprint layer; it remains reusable when the five-area cache format
changes.

## Verification

- A focused test proves an accepted direct fallback and an accepted row gap are counted separately.
- A focused test proves the reviewed audit reports false positives and false negatives correctly.
- Run the complete five-area benchmark plus the Temecula accuracy audit.
- Existing importer tests, Node tests, lint, type checking, and production build remain green.
