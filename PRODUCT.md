# Streetlight product ground truth

Status: approved founder direction  
Approved: 2026-07-27
Updated: 2026-07-28

## Authority

This document defines what Streetlight is supposed to become. It records the founder decisions that future design, code, and product work must follow.

If existing code, old chat transcripts, mockups, or earlier technical suggestions conflict with this document, this document wins. Pricing is the only provisional section. A founder decision is required to change the product rules recorded here.

## Product definition

Streetlight is a hosted web application for churches that organize house-to-house tract distribution.

An administrator defines the church's outreach territory, sees how recently each area was covered, generates printable packets for volunteers, and reconciles the packets after distribution. Streetlight exists to prevent recently covered streets from being repeated while older areas remain untouched.

The application is for administrators. Volunteers continue using paper. They do not need Streetlight accounts, phones, or a reporting process.

The first church is the founder's church. The product should support other churches without changing the core data model, but public signup is not part of the first release.

## Product rules

- Streetlight is a church outreach product. The interface uses terms such as `tracts`, `outreach`, `church`, and `completed`.
- Streetlight is AI-free. Do not add model calls, AI assistants, AI extraction, generated content, or AI route planning without a new founder decision.
- The core workflow is Coverage Heatmap, Generate Packets, Print, and Reconcile.
- Paper is part of the workflow. The product should improve the church's existing process without moving work onto volunteers.
- Coverage selection starts with the street segments that have gone the longest without coverage.
- Geographic and routing behavior must be deterministic and reviewable by an administrator.
- Streetlight stores no resident names, household notes, or volunteer identities.
- The service must be inexpensive enough that operating it for the first church does not create an ongoing loss.

## Roles and workspaces

Version one has one authenticated role: administrator.

- A church has one workspace.
- A workspace has one outreach territory.
- All administrators have the same permissions.
- Volunteers have no application access.
- Multiple campuses, multiple territories, custom roles, and volunteer accounts are outside the first release.

## Domain vocabulary

| Term | Meaning |
|---|---|
| Coverage area | The church's outreach territory. |
| Street segment | A short section of street tracked as one coverage unit. |
| Home count | The estimated number of residential homes, and therefore tracts, assigned to a packet. |
| Packet | One connected volunteer assignment map and, once printed, its sheet plus the matching number of tracts. |
| Batch | A group of packet proposals generated together and, once approved, finalized and printed together. |
| Active packet | A finalized packet whose street segments remain reserved. |
| Completed packet | A packet whose paper sheet was taken and later recorded as completed during reconciliation. |
| Last covered | The most recent reconciliation date recorded for a street segment. |
| Exclusion area / ignore zone | A saved polygon that excludes an area from packet generation while enabled. The setup page uses `excluded area`; pricing may use `ignore zone`. |
| Priority zone | An area preferred during packet generation, subject to coverage age and packet constraints. |

## Coverage model

The tracked street-coverage unit is a short street segment rather than an individual household.
Apartment complexes are separate tracked outreach units.

- Every selected segment includes residential homes on both sides of the street.
- Streetlight never assigns only one side of a selected segment.
- A turn of about 90 degrees can define a segment boundary. A packet can still contain multiple connected segments across those boundaries.
- Overture connector points and slight bends do not create segment boundaries by themselves.
  No normalized segment may contain more than 100 estimated homes; a longer road is split as
  needed while retaining every assigned address.
- Territory boundaries and ignore zones exclude whole segments from packet selection.
- Address data supplies estimated home counts and packet starting addresses. Retain the house
  number, street, available locality and postcode, and point coordinate for each address assigned
  to a normalized segment. Do not retain resident names, unit identifiers, or notes.
- The first release uses one deterministic global Overture pipeline for transportation segments,
  address points, and residential building footprints. Do not add city-by-city or county-by-county
  production integrations. Authoritative local data may be used only as a test reference.
- Address assignment prefers a nearby matching street name, but name agreement is evidence rather
  than a hard requirement. An otherwise unmatched address may be assigned to an unambiguous nearby
  plausible residential road. Ambiguous addresses remain unmatched.
- Estimated homes begin with unique assigned addresses. A clearly residential Overture building
  may contribute one fallback home only when no address already accounts for it and its road
  assignment is unambiguous. Unknown and non-residential buildings do not contribute fallback
  homes.
- Apartment complexes are tracked separately from street segments. An Overture building explicitly
  classified as apartments is a probable complex; address-only evidence requires at least five
  distinct units at one street address. Smaller multiplexes remain ordinary street outreach.
- Apartment unit evidence contributes only to the complex's clearly labeled estimated tract count
  and does not also increase an adjacent street segment estimate. Streetlight retains the aggregate
  estimate, not individual apartment unit identifiers.
- Every probable apartment complex starts as needs review. An administrator may mark it ready for
  outreach or deferred/inaccessible. All three states remain visible so gated or otherwise
  inaccessible properties are not silently forgotten.
- A ready apartment complex receives its own packet and is never folded into a street packet.
  Apartment packets are atomic: taking one accepts the complete complex, and reconciliation later
  records one completion date for the complex.
- Imported street geometry and estimated home counts cannot be edited in the first release.
- A territory import retains every Overture feature classified as a road. High-confidence
  residential roads are active automatically; all other retained roads begin hidden.
- On the territory editor, an administrator can preview and activate a hidden Overture road.
  Activation applies to the complete connected named road within the territory. Address evidence
  may supply a missing name. A genuinely unnamed road follows its connected chain until a named
  road, intersection, or territory boundary.
- Administrator-activated roads remain active through later imports. A later source refresh may
  update matching geometry but cannot silently hide an approved road; if the source road
  disappears, Streetlight preserves the last approved geometry.
- Exclusion polygons remain the first-release method for removing unsuitable areas. For an
  unsuitable individual segment, an administrator can select that exact segment and exclude it
  without deleting or changing its imported geometry.
- A manually excluded segment remains visible in gray and can be selected and restored. It does
  not contribute to territory eligibility, tract totals, or packet generation while excluded.
  Segment exclusion and restoration follow the territory editor's explicit Save and Cancel model.
- A saved segment exclusion survives later imports while the exact imported segment still exists.
  A materially changed or replacement segment does not inherit the exclusion.
- Drawing roads, changing road geometry, deactivating a complete named road, and correcting home
  counts are outside the first release.
- An administrator can enable, disable, reshape, rename, or delete an exclusion polygon. A
  disabled polygon remains stored and appears as a faint outline in the territory editor, but it
  does not affect segment eligibility or tract totals.
- Completing a packet records a coverage event for every included segment.
- Coverage history must be retained. Correcting a mistake records the correction instead of silently replacing history.

An administrator creates a territory from an address, boundary distance, and either a circle or
square outer boundary, then adjusts that boundary and draws exclusion polygons. The circle uses
the selected distance as its radius. The square uses the exact latitude-aware bounding box that
encloses that circle for the Overture import. The outer boundary is not reshaped as a freeform
polygon. Segments outside the selected boundary are not displayed. Gray segments are always
inside the selected boundary but excluded by an enabled exclusion polygon or exact-segment
override. The administrator can exclude highways, commercial districts, rivers, apartment
complexes, areas assigned elsewhere, and other unsuitable locations.

A territory save reuses imported streets and addresses whenever the proposed territory's enclosing
square fits inside the saved import footprint. It imports again only when the proposed footprint
extends beyond stored geography or the pinned source-data contract requires an upgrade. Ordinary
exclusion, activation, exact-segment, boundary-shape, and contained boundary changes do not import.

Streetlight benchmarks its pinned Overture release and deterministic normalizer against varied
fixed US test territories before treating the estimates as reliable. A low-confidence territory
shows a persistent warning with concrete reasons in Territory Setup and Generate Packets, but the
administrator may continue without another confirmation modal. The warning is not printed on
volunteer packets and remains until a later import passes the quality checks. If the global
pipeline cannot pass its approved benchmark, evaluate a licensed nationwide or global dataset
instead of adding regional production imports or unmeasured heuristics.

The main map colors segments by time since last coverage:

- Red: oldest or never covered
- Orange: older
- Yellow: more recent
- Green: most recent

Each territory stores the day when segments transition to yellow, orange, and red. The defaults are
90, 180, and 365 days. Administrators may edit those three ascending thresholds. The meaning and
order of the colors do not change, and never-covered segments are always red. The exact visual
palette remains a design decision.

## Packet generation

The administrator requests a number of packets and an approximate home count for each packet size.
A request can mix sizes, such as several smaller packets and several larger packets. The generator
automatically matches those requested sizes to suitable connected areas.

Streetlight generates compact, connected groups of street segments. Packets in one generated batch
may be scattered anywhere in the territory, but each individual packet is one connected area.
Streetlight respects the territory boundary, ignore zones, active reservations, and requested home
count.

Selection is oldest-seed-first. Each packet begins with the oldest eligible unassigned segment,
then grows through connected segments in that heatmap range. If it remains below the normal lower
bound, it may progressively include adjacent segments from newer ranges until it becomes viable.
Newer segments are used only as needed to make the older seed serviceable. Equal-age choices begin
nearest the church and expand outward evenly; stable segment identifiers break remaining ties.

The normal tract target is plus or minus 30 percent, but a segment is never split. Within that
range, Streetlight prefers a coherent packet that avoids creating a small leftover branch over a
packet that merely lands closer to the numeric target. It may absorb a whole attached branch when
the result remains within the upper bound and the branch could not satisfy any remaining requested
packet size. One indivisible segment may still produce an oversized packet.

Streetlight does not silently skip an overdue segment because newer geography would make an easier
packet. If an old connected area cannot reach the lower bound even after considering adjacent
segments from every heatmap range, Streetlight reports that the area needs a smaller cleanup
packet. If the requested number of sensible packets cannot be produced, Streetlight returns fewer
proposals with an explanation instead of filling the request with misleading one- or ten-tract
packets.

A packet contains a connected set of highlighted street segments and a proposed starting point. Volunteers choose how to walk the assignment. Taking the packet commits the volunteer to cover every highlighted segment.

Packet map behavior:

- Highlight every selected segment with one stroke centered on its road geometry.
- Preserve the first and last coordinates of the selected geometry; do not shorten the highlight before map-provider snapping.
- A highlighted segment means covering residential homes on both sides of the street.
- Show one proposed starting point.
- Choose a starting house on a terminal segment. Prefer a house north of the road centerline, then the house nearest that segment's outer endpoint.
- If neither terminal segment has a usable numbered address, choose a usable assigned address
  elsewhere inside the packet. If the packet has no usable assigned address, reject that proposal
  with a data warning instead of inventing an address or calling another provider.
- Mark the starting house with Google's standard unlabeled pin.
- Show the estimated home count once in the packet metadata, not as a map overlay.
- Do not show a proposed walking path, walking order, directional arrows, or end point.
- Do not expose internal street-segment numbers on the volunteer packet.
- Do not show individual estimated-home markers in the first release.
- Print the starting address.
- Include a QR code that opens the starting address in Google Maps.
- The QR code is for navigation only. It does not open Streetlight, identify a volunteer, or report completion.
- Print the starting address as text so the packet remains usable without scanning the QR code.

Phase 4 proposals are deterministic and read-only. Administrators may change quantities or target
sizes and regenerate, but cannot move individual segments between proposals. Previewing packet
options does not reserve territory. Reservations begin when the administrator finalizes a batch
for printing. After generation, the map highlights every proposal without starting pins. Selecting
a proposal focuses on that proposal alone and shows its starting pin; the administrator can return
to the all-proposals view.

Streetlight gives each finalized batch an automatic date-and-time name in the church time zone.
Before finalizing, the administrator may replace it with an optional custom name for a special
event. The custom name does not change the stable packet identifiers.

## Printed output

A finalized batch downloads as one multi-page PDF. Each packet occupies exactly one page.

The map occupies most of the page. Street names remain readable and every highlight follows the road centerline. Text outside the map is limited to required attribution and these fields:

- Packet identifier
- Starting address
- Google Maps QR code for the starting address
- Estimated home count and number of tracts needed

Place the QR code beside the printed starting address, visually group them, and indicate that the QR opens directions. Show the estimated homes/tracts prominently at the upper left. The map contains every selected street segment and one proposed starting-point marker. The Streetlight wordmark or logo appears only in the lower-left corner of the page, outside the map, and the packet identifier appears opposite it in the lower-right corner. The page does not repeat the both-sides rule because that is part of the church's normal outreach process.

The first release does not include a written street list, address ranges, an individual-address list, a map legend, volunteer details, a proposed walking path, an end point, detailed navigation, or separate packet files.

After finalization, Streetlight automatically downloads the newly finalized batch. The
administrator can later download either the complete newest finalized batch or one combined PDF
containing every active packet across batches. The all-active download is ordered by oldest batch
first and preserves every packet's original identifier.

## Physical distribution

The administrator prints the batch and places each sheet with the matching number of tracts.

A volunteer takes one sheet and its tracts. Taking them means accepting responsibility for the entire packet. Streetlight has no partial-completion state because the church's process treats each packet as indivisible.

Finalized packets reserve their street segments so another packet cannot include the same segments. A sheet left available remains active and keeps its reservation unless the administrator cancels it.

## Reconciliation

Reconciliation follows the physical table:

1. Streetlight shows every packet in the batch.
2. The administrator selects the paper sheets that are still physically present.
3. Streetlight previews the unselected, missing sheets as completed.
4. The administrator confirms the update.
5. Streetlight records the current reconciliation date as the coverage date for every segment in each completed packet.

The coverage date is the date the administrator reconciles the packet. It is not the batch creation date or an estimated volunteer completion date.

Sheets still present can remain active for a later outreach session or be cancelled. Active sheets keep their reservations. Cancelling a sheet releases its segments back into packet generation.

Administrators can undo an incorrect completion or change its date. Streetlight retains the original event and the correction.

## Administrator dashboard

The first dashboard contains:

- Coverage heatmap
- Total estimated homes in the territory
- Homes covered during a selected period
- Number of active packets
- Generate Batch action
- Reconcile Batch action

The administrator website uses one persistent map workspace at `/`. Coverage, Generate Packets,
and Territory Setup are tools in that workspace rather than separate pages. Switching tools keeps
the map camera, Map/Satellite choice, and each tool's in-progress state. Coverage and Generate
Packets share the complete heatmap; a selected packet adds a distinct review highlight and
starting pin above it. Territory Setup replaces the heatmap treatment with its editing overlays.
The saved church location uses the founder-supplied church marker in every tool, and the header
uses the founder-supplied logo beside the `STREETLIGHT` text. A compact lower-right **Layers** card
opens the Map/Satellite chooser without loading a second map or static-map thumbnail.

Advanced charts, leaderboards, volunteer statistics, and a report builder are outside the first release.

## First release scope

Included:

- Administrator authentication
- Church workspace setup
- Territory creation and correction
- Editable territory boundary shape and distance
- Toggleable and deletable exclusion areas
- Reversible exact-segment exclusions
- Coverage heatmap
- Deterministic packet generation
- Batch preview and finalization
- Packet reservations
- Multi-page PDF generation
- One-page packet layout
- Printed starting address
- Google Maps navigation QR code
- Highlighted packet segments and a proposed starting point
- Batch reconciliation
- Coverage history and corrections
- Basic backup and restore

Excluded:

- Payments and automated subscriptions
- Public signup
- Volunteer accounts
- Multiple territories or campuses
- Custom permission roles
- Native mobile applications
- Advanced reporting
- Email delivery of packets
- Individual household records or notes
- Manual correction of imported street geometry or estimated home counts
- Partial packet completion
- AI of any kind

## Pricing hypothesis

Pricing is provisional until the first church has used the product and real hosting, map, support, and printing behavior are known.

| Plan | Price | Proposed limits and features |
|---|---:|---|
| Free Pilot | Invite only | Up to 500 homes, 10 packets per month, watermark, community email support |
| Basic | $5 per month or $59 per year | Up to 10,000 homes, 200 packets per month, priority and ignore zones, one administrator, email support |
| Pro | $9 per month or $99 per year | Unlimited homes and packets, outstanding-packet and reprint tools, two administrators, custom logo on PDFs |

Rules for later billing work:

- Show annual billing first and allow monthly billing.
- Do not implement payments until the product works for the founder's church.
- The Free plan is invite-only during the pilot. A permanent public free plan requires a later decision.
- There is no active lifetime or first-25-church pricing promise.
- Core workflow and data integrity take precedence over provisional plan gating. A plan cannot omit behavior required to reserve, reconcile, or correct its packets.
- Exact limits and feature divisions can change after pilot evidence. The single-church no-loss constraint remains firm.

## Technical decisions left open

The following are implementation choices, not founder decisions:

- Application framework and repository layout
- Database and geospatial extensions
- Authentication provider
- Map and geocoding providers, and any commercial address-data fallback required only if the
  approved global Overture pipeline fails its benchmark
- Hosting provider
- PDF rendering method
- Payment provider
- Low-level packet-selector implementation details that do not change the approved ordering,
  tolerance, connectivity, or fallback rules
- Logo, typography, and final visual design

Choose the smallest stack that supports a hosted multi-church service, deterministic geospatial work, printable packets, backups, and low operating cost. Do not preserve an existing dependency or service merely because it appears in the repository.

## Existing repository status

The repository at the time of approval contains a Next.js web shell, a NestJS API shell, partial Clerk authentication, deployment files for Vercel and Fly.io, one brand test, and one undiscovered API health test.

It contains no database schema, territory model, map, address import, packet generator, segment-grouping logic, PDF generator, reservation model, reconciliation flow, or Streetlight domain data.

The current scaffold is not a product implementation and is not production-ready. Its frameworks, authentication flow, deployment targets, and monorepo structure can be replaced. Preserve the Git repository and history as an archive, but begin the product implementation from the ground truth in this document.

## Change control

Future agents and contributors must:

1. Read this document before planning or changing product behavior.
2. Distinguish approved product rules from provisional pricing and open technical choices.
3. Keep volunteers outside the application workflow.
4. Keep the core product deterministic and AI-free.
5. Ask for a founder decision before changing a product rule.
6. Update this document when the founder approves a product change.
