# Phase 4 Deterministic Packet Proposals Design

**Date:** 2026-07-28  
**Status:** Founder-approved design  
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
- the heatmap range from which it was selected.

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
2. Process ranges from oldest to newest: red, orange, yellow, then green. Never-covered segments
   are red.
3. Within the current range, choose the remaining segment nearest the church as the next anchor.
4. Grow a connected candidate around that anchor using only segments in the same heatmap range.
5. Match that connected area to the remaining requested tract target that fits it best.
6. Remove the chosen segments and target slot, then repeat.
7. Move to the next-newer heatmap range only after no segments remain in the older range or no
   request slots remain.

Distance within a heatmap range is measured deterministically from the church center to segment
geometry. This makes an initially all-red territory expand outward from the church in rings instead
of finishing one distant direction before nearby streets elsewhere.

When multiple connected additions are possible, prefer the addition that preserves the outward
expansion, then the smallest resulting geographic footprint, then a stable segment-ID tie-breaker.
Exact coverage dates do not override geographic expansion within the same configured heatmap range.
This is a small deterministic heuristic, not route optimization.

For each remaining requested size, the selector considers the connected prefixes grown from the
anchor and keeps the prefix closest to that target. It assigns the target with the best relative
fit, using the request's stable input order as the final tie-breaker. This allows a small isolated
cul-de-sac to receive a small requested target while a larger connected area receives a larger one.

## Target tolerance and exceptions

The normal target range is plus or minus 20 percent. A segment is never split.

- A connected area may become an intentionally undersized packet rather than pulling in streets
  from a newer heatmap range.
- A single indivisible segment may exceed the upper tolerance and become an oversized packet.
- If request slots remain after an older range is exhausted, the selector continues with the next
  range so the requested packet count is honored.
- If the territory runs out of eligible segments or usable starting addresses, the selector
  returns fewer proposals with a clear explanation.

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

## Administrator page

The Coverage dashboard receives a primary **Generate packets** action leading to a dedicated page.
The page uses the existing full-height map shell:

- The sidebar contains request rows with native quantity and target inputs, an **Add packet size**
  action, and **Generate proposals**.
- After generation, the sidebar lists proposal cards with target and estimated tract count.
- Selecting a card focuses the interactive Google map on that packet alone.
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

- fewer eligible connected areas exist than requested;
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
- normal results meet the 20-percent tolerance;
- isolated undersized and indivisible oversized exceptions are deterministic;
- starting addresses belong to selected segments and follow the approved fallback order; and
- insufficient data returns fewer proposals without mutation.

Browser acceptance uses the real Temecula territory to request mixed packet sizes, inspect every
proposal map and starting address, regenerate unchanged inputs, and confirm that the result is
identical.

Phase 4 then stops at its human-review checkpoint. The founder reviews grouping, counts, highlighted
segments, outward expansion, and starting points before Phase 5 begins.
