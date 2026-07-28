# Streetlight Phase 2 hidden-road activation design

Status: awaiting founder review of the written specification
Designed and conceptually approved: July 28, 2026

## Purpose

Streetlight cannot silently omit a residential road from coverage history, heatmaps, or packet
generation merely because Overture names or classifies it incompletely. Automated classification
should handle ordinary residential roads, while the administrator needs one deterministic,
persistent way to recover a road from the imported source data.

The Hillsdale Heights example is the binding regression. Overture contains its residential road
geometry as multiple unnamed pieces, and nearby Overture addresses provide strong evidence for the
road name. The prior strict completeness gate rejected the entire genuine territory import because
many other addresses remained unmatched. This design retains uncertain geometry for review instead
of treating every uncertainty as a fatal import error.

## Approved approach

Each territory import retains every Overture feature whose subtype is `road` within the imported
footprint:

- High-confidence residential road groups become active automatically.
- Every other retained road group begins hidden.
- Footpaths, cycle paths, trails, steps, and other features not classified by Overture as roads are
  not retained.

The stored source state and territory eligibility are separate:

- `active` or `hidden` records whether a road can participate in outreach.
- The radius and exclusion polygons independently decide whether an active road is currently
  eligible.

This separation preserves the existing orange/gray territory preview while allowing uncertain
source geometry to remain available without entering packet generation.

## Import classification

The existing deterministic residential and address-evidence rules decide which road groups are
high confidence. Named `residential` and `living_street` geometry remains automatically active.
The importer may also activate other road classes when the accepted address-evidence rule proves
residential use.

Failure to prove residential use does not discard an Overture road. It stores the road as hidden.
Classes such as service and unclassified therefore remain recoverable but never become active
merely because their geometry exists.

Unmatched addresses and unresolved address-name clusters remain import quality metadata and
diagnostic evidence. They do not fail an otherwise valid import. The import still fails before its
database transaction when the Overture response is unavailable, malformed, empty for a footprint
that should contain roads, or fails structural validation. A failed import preserves the complete
previous active and hidden road sets.

This changes the importer contract beyond normalizer version `2`. A stored version-2 footprint
therefore requires one replacement import even when its release, center, and radius are unchanged.

## Deterministic road groups

Activation operates on a logical road group rather than a single source piece.

1. Connected geometry with the same canonical name forms one group within the territory.
2. Unnamed geometry that satisfies the accepted nearby-address consensus rule inherits that street
   name before grouping.
3. A genuinely unnamed selected piece continues through connected unnamed geometry until it
   reaches a named road, a branching intersection, or the territory boundary.
4. Disconnected roads with the same name are separate groups.

The editor highlights the complete proposed group before activation. This makes the consequence
reviewable and prevents a click from silently enabling unrelated disconnected geometry.

## Territory editor

The existing Territory Setup page remains the editor. It gains one `Show hidden roads` toggle:

- The toggle is off by default to preserve the normal radius-and-exclusion view.
- When enabled, hidden roads appear as thin, semi-transparent blue-gray lines.
- Active eligible roads remain semi-transparent orange.
- Active roads excluded by the radius or an exclusion polygon remain gray.
- Hidden candidates do not contribute to eligible segment or tract totals.

Clicking a hidden line selects its complete deterministic road group and highlights the preview.
The sidebar shows its resolved or inferred name when available and an `Activate road` action.
Activating changes only the page draft. The existing `Save changes` action persists all territory,
exclusion, and road-activation changes atomically; `Cancel` restores the saved state.

The first release does not add a second map editor, freehand drawing, bulk approval workflow, or
background lookup when the map is clicked.

## Persistence across imports

Administrator activation is an enduring override:

- A later import cannot return an approved road to hidden status.
- When matching Overture source features still exist, a re-import may refresh their geometry and
  derived estimate.
- When a previously approved source feature disappears, Streetlight preserves its last approved
  geometry and estimate rather than silently removing it.
- Newly encountered source geometry goes through the normal automatic-or-hidden classification.

Source identities match current features across imports. Administrator approval is stored
independently from automatically derived status, and the last approved record survives when a
source identity disappears. No provider abstraction or generalized road-versioning layer is
required.

## Home estimates

Hidden road groups retain address assignments and their derived estimated home counts when
available. Activating a road exposes that existing deterministic estimate; it does not recalculate
the count from an AI model or permit manual correction. A road with no supporting address estimate
may still be activated with a zero estimate so that its geometry is not omitted from the outreach
map.

## Scope boundaries

This amendment does not add:

- Custom or freehand road drawing
- Editing or snapping imported road geometry
- Individual-road deactivation or deletion
- Manual home-count correction
- AI classification or inference
- On-demand Overture network queries from map clicks
- A second territory editor

Existing exclusion polygons remain the way to remove unsuitable active roads in the first release.

## Acceptance criteria

Automated verification must prove:

- A genuine import retains all Overture `road` features as active or hidden.
- High-confidence residential roads activate automatically.
- Service, unclassified, and other uncertain road features remain hidden but selectable.
- Hillsdale Heights receives its address-supported name and activates automatically as one
  connected group.
- A lower-confidence hidden road previews as one complete group and can be activated.
- A genuinely unnamed chain stops at named roads, branching intersections, and the territory
  boundary.
- Hidden roads never contribute to eligible totals or later packet selection.
- Cancelling a draft activation writes nothing.
- Saving and reloading preserves activation.
- A later import preserves administrator activation, including the last approved geometry when its
  source disappears.
- An invalid import preserves the previous active and hidden datasets.

Browser verification must confirm that the hidden-road toggle is understandable, road names remain
readable through the overlay, the complete selection is visible before activation, Hillsdale
Heights is active, and a manually activated candidate remains active after reload and re-import.

## Completion condition

Without drawing or editing geometry, the founder can reveal the retained Overture road pool,
activate a missing residential road as one understandable group, save it, and trust that future
imports will not silently remove that decision.
