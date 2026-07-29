# Apartment outreach design

## Purpose

Streetlight tracks apartment complexes without pretending they behave like houses distributed
along a street. A probable complex remains visible until the church reviews it, and an accessible
complex receives its own packet.

## Detection

Detection is deterministic and global:

- an Overture building with class `apartments` is always a probable complex;
- an address-only premise becomes a probable complex when at least five distinct nonblank
  Overture unit values share its street, house number, and postcode;
- unit evidence within an apartment footprint belongs to that building rather than creating a
  duplicate address-only complex; and
- duplexes and premises with fewer than five address-only units remain ordinary street outreach.

Streetlight stores the aggregate evidence and estimated tract count, not individual apartment
unit identifiers. Apartment addresses and unit evidence do not also increase the adjacent street
segment estimate.

## Review states

Every imported complex starts as `needs_review`. The administrator may change it to:

- `ready`: accessible and eligible for its own apartment packet; or
- `deferred`: reviewed but currently inaccessible, including gated complexes.

All three states remain visible. Reimports preserve the administrator's state when the same
source complex remains present. A source complex that disappears is retired without deleting its
packet or future coverage history.

## Map and territory setup

Complexes use a distinct apartment marker rather than a road stroke:

- needs review: amber;
- ready: blue;
- deferred: gray.

Selecting a marker opens the Apartment complex section in Territory Setup. It shows the best
available address, `Estimated tracts: N`, the evidence used for the estimate, and the three review
states. Estimates are always labeled as estimates and are not manually edited.

## Packet generation

Every unreserved `ready` complex is proposed as one apartment packet in addition to the requested
street packets. Marking a complex ready is the administrator's explicit decision to include it in
the next generated batch; the review screen identifies apartment proposals before finalization.

An apartment packet contains:

- one complex marker and a tightly focused Google map;
- the best available complex address and directions QR code;
- the clearly labeled estimated tract count; and
- the same packet and batch identifiers as a street packet.

It contains no artificial street segments. Finalization reserves the complex so it cannot appear
in another active packet.

## Completion

Apartment packets are atomic. Taking the packet means accepting the whole complex; reconciliation
later marks the complete complex covered on one date. If access prevents completion, it remains
outstanding and may be returned to `deferred`.

## Benchmark correction

The fixed-territory count benchmark measures premises, not raw reference points. Reference points
sharing canonical street, full house number, and postcode count once for the street-segment count
metric. Repeated sub-address points are reported separately and do not make one apartment building
look like hundreds of houses distributed along a road.

The benchmark emits exact problem diagnostics—street, source segment, coordinates, competing
names, expected premises, estimated tracts, and duplicate-point evidence—without changing
normalizer behavior to fit a fixture. Existing areas remain fixed holdouts.

## Scope boundaries

This design adds no LLM, Google-image extraction, manual tract editing, access instructions,
partial apartment completion, apartment walking routes, or church-specific detection rules.

