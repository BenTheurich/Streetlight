# Apartment Site Model

## Goal

Represent apartments honestly without removing them from the territory or pretending that each
imported apartment building is a complete real-world complex. Apartment evidence remains visible to
administrators from import onward. Only an administrator-configured apartment complex can enter
packet generation.

## Product terminology

- **Apartment evidence** is an imported apartment-class building, address premise, or apartment
  land-use boundary. Evidence is source data; it is not automatically a confirmed complex.
- **Apartment site** groups one or more pieces of apartment evidence. A source boundary may propose
  a grouping, or an administrator may create one.
- **Apartment complex** is an apartment site whose building membership has been confirmed by an
  administrator.

Streetlight must not describe every imported evidence record as a complex. Setup summaries distinguish
confirmed complexes from ungrouped apartment buildings.

## Import and proposed grouping

The pinned Overture import remains the only apartment data provider.

- Apartment-class building footprints and address premises remain apartment evidence and do not
  contribute to ordinary street tract counts.
- A land-use polygon explicitly tagged as an apartment residential property may propose one site
  containing the apartment evidence inside it.
- Nearby buildings are not automatically grouped without that boundary evidence.
- Evidence without a credible property boundary remains an ungrouped apartment candidate.
- Source-provided names, addresses, unit counts, and boundaries are suggestions. Missing values stay
  missing; footprint calculations do not become operational tract quantities.

Source imports may refresh evidence, but they must not overwrite an administrator-confirmed grouping
or its configuration. Stable evidence identifiers are retained with each site so confirmed groupings
can be carried across a later import.

## Setup map and grouping

- All current apartment evidence is visible to administrators in Setup.
- An ungrouped candidate uses a subdued `A` marker.
- A proposed or confirmed multi-building site uses one primary `A` marker; selecting it highlights
  its member buildings and any available source boundary.
- An administrator can select one or more ungrouped candidates and confirm them as one apartment
  site. A one-building site is valid.
- An administrator can edit a site's membership by adding or removing apartment evidence before
  reconfirming it.
- Custom polygon drawing is not required for the first version. Membership is the selected set of
  evidence records; a source polygon is displayed when one exists.

The Setup section is named **Apartments**. Its summary reports confirmed complexes and ungrouped
buildings separately instead of displaying an unsupported complex count.

## Configuration and packet readiness

An apartment site is packet-ready only when all four conditions are satisfied:

1. Its evidence grouping is confirmed.
2. A usable primary address or entrance is present and explicitly confirmed.
3. An administrator enters a positive tract quantity.
4. Access is explicitly classified as `Open` or `Restricted`.

`Unknown` is the default access value and does not satisfy readiness. Packet readiness is computed
from these conditions; it is not a separate administrator-managed status.

An independently auto-saved **Include in packet generation** checkbox remains available. It is
disabled until the site is packet-ready. Checking it includes the complex in future proposals;
unchecking it removes the complex without deleting its grouping or configuration. Removing any
required fact automatically turns packet inclusion off.

Apartment configuration and packet inclusion save independently from Region Setup Save and Cancel.
Confirmed failures restore the last saved value and offer retry. Uncertain responses require reload
verification instead of claiming success.

## Packet behavior

- Unconfigured or unincluded apartment evidence remains visible in Setup but never appears in
  packets, printouts, or other field-facing output.
- One included apartment complex produces one atomic apartment packet and is never folded into a
  street packet.
- The administrator-confirmed tract quantity controls packet sizing and display. Imported footprint
  estimates do not participate in packet selection.
- The first version does not split a complex into building or route sub-packets, even when its tract
  quantity exceeds a normal street-packet target.
- A restricted complex may be included, but its packet must carry a clear restricted-access warning.
- Taking and reconciling an apartment packet continues to reserve and complete the entire complex.

Coverage-tool presentation is intentionally outside this decision. The data model retains apartments
as a distinct category so Coverage can represent them later without changing packet readiness.

## Persistence and compatibility

The existing apartment and packet history remain valid. The current apartment storage gains explicit
site membership and configuration fields rather than creating a second competing apartment system.
Legacy review statuses cease to control product behavior.

Existing imported rows migrate to ungrouped, unconfigured, unincluded apartment candidates. Historical
packets and coverage events keep their existing target references. New packet proposals require the
explicit inclusion flag and all readiness conditions.

## Validation

- Source-boundary grouping tests prove that contained evidence becomes one proposed site and nearby
  evidence without a boundary remains separate.
- Import persistence tests prove that confirmed site membership and configuration survive refreshes.
- Database and route tests cover grouping, membership edits, exact configuration validation,
  readiness, inclusion, automatic exclusion after invalidation, church isolation, and replay safety.
- Packet tests prove that only configured and included sites participate, use the confirmed tract
  quantity, remain atomic, and carry restricted-access metadata.
- UI tests and a signed-in localhost pass cover truthful counts, ungrouped and grouped markers,
  grouping edits, configuration, independent autosave, recovery states, keyboard access, and sidebar
  fit at desktop and narrow widths.
