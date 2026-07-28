# Phase 4 Deterministic Packet Proposals Design

**Date:** 2026-07-28  
**Status:** Founder-approved design, amended for orphan prevention
**Authority:** `PRODUCT.md` remains authoritative

## Purpose

Phase 4 turns the saved territory and coverage heatmap into deterministic, read-only packet
proposals. An administrator requests quantities and approximate tract counts, reviews each proposed
map, and receives the same proposals whenever the territory, heatmap settings, reservations, and
request are unchanged.

This phase does not save batches, reserve segments, generate PDFs, or reconcile completed outreach.
Those remain Phases 5 and 6.

## Terms

- A **batch** is one generation request containing multiple packet proposals. Packets in the same
  batch may be scattered anywhere in the territory.
- A **packet** is one volunteer's map. Its selected street segments form one continuous, connected
  area.
- A **tract target** is approximate. Every selected segment includes both sides of its street and
  cannot be split merely to hit a target.

## Inputs and outputs

The administrator may request mixed sizes in one batch, such as three 15-tract packets and four
30-tract packets. Every request row contains a positive whole-number quantity and target.

Each proposal contains:

- its requested tract target;
- its selected segment IDs and geometries;
- the sum of the selected segments' estimated homes;
- its proposed starting address and address coordinate;
- a deduplicated, admin-only street-name summary; and
- the heatmap ranges represented in it.

The Phase 4 street summary is for reviewing a proposal in the administrator interface. It does not
change the approved Phase 5 printed packet content.

## Eligibility

A segment may be proposed only when it is current, active, inside the saved territory boundary,
outside enabled exclusion areas, not individually excluded, and not reserved by an active packet.
Hidden and otherwise ineligible segments never enter the selector.

Selected segments are removed from consideration for the rest of the preview batch, so a segment
cannot appear in two proposals. Preview generation does not itself reserve anything.

## Selection order

The selector operates on the whole requested batch, not on one neighborhood:

1. Classify eligible segments with the administrator's current heatmap thresholds.
2. Choose the oldest eligible unassigned segment as a protected seed. Never-covered segments are
   older than dated segments.
3. Grow connected candidates from that seed, preferring segments in the seed's heatmap range.
4. If every same-range candidate remains below the lower target bound, progressively consider
   adjacent segments from ranges newer than the seed as needed.
5. Match the resulting connected candidates to the remaining requested target they fit best.
6. Prefer a candidate that avoids leaving an attached component unable to satisfy any remaining
   request over one that is merely closer to its target.
7. Remove the chosen segments and target slot, then repeat from the oldest remaining seed.

Coverage age is the primary ordering rule. For equal coverage dates, distance from the church to
segment geometry preserves the approved outward expansion. An initially all-never-covered territory
therefore progresses outward from the church. Stable segment identifiers break remaining ties.

Cross-range filling is a fallback for making an old seed viable, not a reason to repeat recently
covered neighboring streets when enough older connected geometry exists. Candidate comparison is
deterministic and bounded to the imported street graph; this remains a grouping heuristic rather
than route optimization.

## Road connectivity

Packet connectivity uses the retained Overture geometry rather than the visual Google basemap.
Besides exact shared endpoints, the packet graph recognizes:

- a road endpoint meeting another segment's interior at a true T-junction; and
- a short same-name continuation gap when the two pieces have compatible direction.

The implementation uses conservative, fixture-backed tolerances. It does not connect unrelated
nearby roads, parallel roads, or roads merely because they look close on the map. These additional
graph edges do not change imported line geometry or split a normalized segment; they only record
that two whole segments are connected for packet grouping.

## Target tolerance and exceptions

The normal target range is plus or minus 30 percent. A segment is never split.

- Within the normal range, preventing a small stranded remainder outranks numeric closeness to the
  target. For example, a 109-tract packet may beat a 99-tract packet when the additional ten tracts
  complete an attached cul-de-sac.
- A packet may absorb a whole attached branch when it remains at or below 130 percent and the
  branch could not satisfy any remaining requested packet size.
- A single indivisible segment may exceed the upper tolerance and become an oversized packet.
- If an old seed cannot reach 70 percent even after considering connected segments from every
  heatmap range, it is reported as needing a smaller cleanup packet rather than silently skipped.
- If the requested count cannot be met with sensible proposals, the selector returns fewer
  proposals with a clear explanation. It does not fill slots with arbitrary tiny packets.

Active zero-estimate residential segments remain eligible. Their selection does not increase a
packet's estimate, and the finite no-duplicate rule prevents them from causing an endless search.

## Starting-address data

The Phase 2 importer currently retains only assigned-address counts. Phase 4 extends that same
Overture import to retain the minimum address data needed for proposals:

- house number;
- street;
- available postal city or locality;
- available postcode; and
- point coordinate.

The records are stored under the normalized segment to which the importer assigned them. Streetlight
does not retain resident names, unit identifiers, or notes. Estimated homes continue to come from
the assigned-address count; Phase 4 does not add estimate-correction controls.

Overture's address schema provides these components and a point geometry, but its documentation
notes that regional coverage and field completeness vary:

- <https://docs.overturemaps.org/schema/reference/addresses/address/>
- <https://docs.overturemaps.org/guides/addresses/>

A usable written address requires a house number and street. Available locality and postcode are
included when present. Starting-address selection is deterministic:

1. Consider usable addresses assigned to a terminal segment of the proposed connected group.
2. Prefer the north side of the road centerline.
3. Then prefer the address nearest the terminal's outer endpoint.
4. If neither terminal has a usable address, choose the best usable assigned address anywhere
   inside the packet.
5. If the packet has no usable address, reject that proposal with a data warning rather than
   inventing an address or calling another service.

The preview uses Google's standard unlabeled pin at the chosen address. The existing pilot territory
is reimported once during Phase 4 development to populate address records. Future imports include
them normally; no customer migration workflow is needed before there are customers.

## Administrator workspace

**Generate packets** is a tool in the persistent map workspace at `/`:

- The sidebar contains request rows with native quantity and target inputs, an **Add packet size**
  action, and **Generate proposals**.
- After generation, the sidebar lists proposal cards with target and estimated tract count.
- The complete generated set is highlighted after generation. Selecting a card focuses the
  interactive Google map on that packet alone.
- The map shows the proposal's connected segments, normal road labels, and standard Google
  starting-address pin.
- The selected proposal shows its written starting address and admin-only street summary.
- Request controls remain editable. Regenerating replaces the preview.

The map remains the majority of the page. Phase 4 does not add QR codes, PDF copy, route order,
walking arrows, end points, manual segment movement, proposal reordering, or explanatory filler.

## Persistence and concurrency

Packet proposals are derived responses, not database records. Phase 4 does not insert into
`batches`, `packets`, or `packet_segments`.

Phase 5 will revalidate every selected segment against current eligibility and reservations inside
the finalization transaction before persisting the batch. This prevents a stale Phase 4 preview
from creating duplicate active assignments.

## Errors

The page rejects non-integer, zero, and negative quantities or tract targets before generation.
The server validates the same boundary independently.

Generation returns specific, non-mutating warnings when:

- fewer sensible packets exist than requested;
- an overdue connected area requires a smaller cleanup packet;
- one or more otherwise selectable areas lack a usable starting address; or
- no eligible segments remain.

Provider or import failures remain territory-import errors. Packet generation never starts a second
map-data provider workflow.

## Verification

One fixed synthetic graph and one saved real Temecula fixture prove:

- identical inputs produce identical ordered proposals;
- mixed requested sizes are matched to appropriate connected areas;
- red precedes orange, orange precedes yellow, and yellow precedes green;
- an all-red fixture expands outward from the church;
- every selected segment is eligible and appears on the proposal map;
- active reservations and every exclusion form are respected;
- every proposal is connected;
- no segment appears twice in one batch;
- estimated homes equal the selected-segment sum;
- normal results meet the 30-percent tolerance;
- an old seed uses newer adjacent ranges only when same-range geometry cannot reach the lower bound;
- an attached small branch is absorbed when doing so prevents an unusable remainder;
- viable normal candidates are chosen instead of arbitrary tiny components;
- exact T-junctions and conservative same-name gaps are connected without joining unrelated roads;
- cleanup warnings and indivisible oversized exceptions are deterministic;
- starting addresses belong to selected segments and follow the approved fallback order; and
- insufficient data returns fewer proposals without mutation.

Browser acceptance uses the real Temecula territory to request mixed packet sizes, inspect every
proposal map and starting address, regenerate unchanged inputs, and confirm that the result is
identical.

Phase 4 then stops at its human-review checkpoint. The founder reviews grouping, counts, highlighted
segments, outward expansion, and starting points before Phase 5 begins.
