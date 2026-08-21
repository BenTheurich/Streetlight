# Incremental Region Import Design

Status: approved  
Approved: 2026-08-04

## Goal

Reuse the current normalized Overture generation when a saved region expands or moves, downloading
and normalizing only newly covered geography where that is safe and useful.

## Design

Represent import coverage as its latitude-aware square bounding box. When a current, compatible
Overture import overlaps the requested box, subtract the old box from the new box into at most four
non-overlapping rectangles. Import those rectangles and merge their normalized output with the
current generation. A contained shrink imports nothing. A disjoint recenter, source release change,
normalizer change, or missing current normalized data uses the existing full import.

The Python importer accepts an explicit bounding rectangle in addition to its existing center/radius
contract. Each rectangle is normalized independently. The TypeScript importer merges rectangles in
stable order. Streets deduplicate by imported segment identity and combine distinct address evidence;
buildings deduplicate by source and source ID; apartments deduplicate by imported complex identity.
Existing entities remain unless a matching imported identity replaces or enriches them. Known
addresses deduplicate exactly. Anonymous homes inferred from building footprints have no persisted
building-to-road identity, so their strip counts are added as estimates; a building crossing a
strip seam may therefore contribute one extra estimated home.

The merged result describes the complete requested import footprint and is passed to the existing
`saveTerritoryDraft` transaction. That transaction remains responsible for generation replacement,
coverage-history retention, exclusion preservation, manually activated/hidden roads, apartment
review status, and rollback. No region or generation changes are saved until every incremental
rectangle imports and the merged payload validates.

## Recovery and UX

Keep the current save request, prominent import progress overlay, error response, and editable draft.
If any rectangle download, normalization, merge, validation, or database write fails, the request
fails and the previously saved region and generation remain current.

## Verification

Focused checks cover outward expansion, partially overlapping recentering, contained shrinking,
disjoint recenter fallback, overlap deduplication for streets and buildings, preserved manual and
review state through the generation swap, and failure before or during replacement.

## Deliberate limits

Do not persist raw Overture features or add a job queue. Accept the small possible seam overcount
for anonymous building-based estimates. A future source/normalizer change performs one full refresh
because previously normalized data is not a safe input to a changed normalizer.
