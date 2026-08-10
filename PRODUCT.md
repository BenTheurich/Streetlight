# Streetlight product ground truth

<!-- impeccable:product-schema 1 -->

Status: approved founder direction  
Approved: 2026-07-27
Updated: 2026-08-10

## Platform

web

## Authority

This document defines what Streetlight is supposed to become. It records the founder decisions that future design, code, and product work must follow.

If existing code, old chat transcripts, mockups, or earlier technical suggestions conflict with this document, this document wins. Pricing is the only provisional section. A founder decision is required to change the product rules recorded here.

## Users

Streetlight's primary user is a church administrator organizing house-to-house tract distribution
from a church office. The administrator defines and reviews the outreach region, prepares printed packet
batches, and reconciles returned paper after outreach. Volunteers remain outside the application:
they take a printed packet and matching tracts without needing an account, phone, or reporting
process.

The founder reviews access requests. Approved churches share one administrator role inside
one church workspace and one outreach region.

## Product Purpose

Streetlight is a hosted web application for churches that organize house-to-house tract distribution.

An administrator defines the church's outreach region, sees how recently each area was covered, generates printable packets for volunteers, and reconciles the packets after distribution. Streetlight exists to prevent recently covered streets from being repeated while older areas remain untouched.

The application is for administrators. Volunteers continue using paper. They do not need Streetlight accounts, phones, or a reporting process.

The first church is the founder's church. The product should support other churches without changing the core data model, but public signup is not part of the first release.

Visitors may request access from the public landing page. A request does not create an account.
The founder reviews requests and manually invites approved church administrators. Public copy
describes the 90-day free trial; `pilot` remains an internal implementation and rollout term.

When signed out, `/` shows the approved public landing page. When signed in to a configured
church, `/` shows the persistent administrator map workspace. The final
`spread-the-light-v2` prototype is the visual source for the public page.

## Positioning

Streetlight is a deterministic, paper-native coverage memory for church outreach. Its distinctive
mechanism connects a reviewable region map to printable volunteer assignments and then closes
the loop through physical-sheet reconciliation. It prevents recently reached streets from being
repeated while older streets are forgotten, without requiring volunteers to install an app,
identify themselves, or report household-level activity.

## Operating Context

An administrator works from one persistent map workspace with four tools: Coverage, Packets,
Outreach Progress, and Setup. The recurring operational cycle is Coverage, Generate, Print, and
Reconcile. Generate and Reconcile are views inside Packets; region configuration and
church-wide printout settings are views inside Setup.

Paper is a first-class part of the system. Packet sheets are printed and placed with matching
tracts, volunteers take them, and the administrator later compares Streetlight with the sheets
still physically present. Outreach Progress is a separate reflective view that can be printed or
left running unattended on a church display.

## Capabilities and Constraints

- Streetlight deterministically imports and normalizes region geography, records append-only
  coverage history, generates connected packet proposals, reserves finalized assignments, renders
  printable PDFs, and reconciles complete paper packets.
- Version one has one administrator role, one workspace and outreach region per church, and no volunteer
  accounts, household records, partial packet completion, advanced reporting, or public signup.
- Product behavior is AI-free, geographically reviewable, privacy-minimizing, and inexpensive
  enough that the founder-church pilot does not operate at an ongoing loss.
- The approved pilot architecture and provider boundaries are binding until measured needs cross
  the migration thresholds recorded below. Pricing remains provisional.

## Brand Commitments

- The product name is Streetlight, represented by the founder-supplied lamp mark and church marker.
- Product language is direct and church-specific: `tracts`, `outreach`, `church`, `packets`, and
  `completed` are preferred over generic marketing terminology.
- The public experience follows the approved `spread-the-light-v2` source, while the authenticated
  product remains calm, map-first, and operational.
- New churches default to the printout message `Ye are the light of the world.` with the reference
  `Matthew 5:14`; an administrator may change or remove both for future packet PDFs.

## Evidence on Hand

- The founder church is the first pilot workspace and supplies the real operating ritual this
  product models: printed packet sheets, matching tracts, physical distribution, and later
  reconciliation.
- The implemented application, deterministic demo data, migrations, and automated checks live in
  `web/`; the production importer and its measured geographic benchmark evidence live in
  `web/importer/` and `docs/benchmarks/`.
- `DESIGN.md` records the approved incumbent visual system. Founder-supplied marks and public-page
  assets live under `web/public/`.
- Streetlight has no approved public testimonials, outcome claims, volunteer-performance evidence,
  or claims about people or spiritual results. Future work must not fabricate them.

## Product Principles

1. Preserve the paper workflow instead of transferring work to volunteers.
2. Make geographic choices, packet selection, and coverage history deterministic and reviewable.
3. Record only the minimum church and region data required; never create resident or volunteer
   profiles.
4. Prefer truthful operational clarity and recoverable errors over automation, prediction, or
   decorative analytics.
5. Keep the pilot architecture small and inexpensive until measured use requires more.

## Accessibility & Inclusion

The administrator workspace must remain keyboard-operable with visible focus, explicit labels,
readable contrast, recoverable status messages, and touch targets suitable for supported tablet
widths. Motion-heavy presentation behavior honors reduced-motion preferences. Volunteers are not
required to own a compatible phone, create an account, or disclose an identity because every
assignment remains usable as printed paper.

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
- A workspace has one outreach region.
- All administrators have the same permissions.
- WorkOS organization membership is the administrator roster. Streetlight does not maintain a
  second user-membership system.
- The authenticated Church account page lists active administrators and pending invitations for
  the current church. Any administrator may invite another full administrator, revoke a pending
  invitation, or remove another administrator from that church. An administrator cannot remove
  their own membership.
- Volunteers have no application access.
- Multiple campuses, multiple regions, custom roles, and volunteer accounts are outside the first release.

## Access requests and onboarding

- The public request form collects church name, contact name, email, city/state, and an optional
  description of the church's current outreach process.
- Repeated submissions for the same normalized church and email do not create additional records
  or reveal the request's status. Public validation uses ordinary server checks and a hidden
  honeypot; the pilot does not add CAPTCHA or a separate anti-spam service.
- Only the founder account configured by the deployment may review requests. The founder may
  correct the church name and invitation email before approving.
- Approval creates one WorkOS organization, one provisional Streetlight church, and one
  organization-specific administrator invitation. Retrying approval must not duplicate any of
  them. Declining a request sends no email and does not prevent a later approval.
- An invited administrator confirms the church name, full church address, and time zone at first
  sign-in. A valid Google geocode is required.
- A new church begins with a one-mile circular region draft centered on the church. It remains
  in Region Setup until the first explicit save succeeds; that save is the first action that
  may launch an Overture import.
- Existing configured church workspaces bypass onboarding unchanged.

## Domain vocabulary

| Term | Meaning |
|---|---|
| Coverage area | The church's outreach region. |
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
Included apartment sites are separate tracked outreach units. Apartment evidence defaults to not
included, remains visible in Setup, and does not enter field-facing packets or printouts until an
administrator deliberately includes it.

- Every selected segment includes residential homes on both sides of the street.
- Streetlight never assigns only one side of a selected segment.
- A turn of about 90 degrees can define a segment boundary. A packet can still contain multiple connected segments across those boundaries.
- Overture connector points and slight bends do not create segment boundaries by themselves.
  No normalized segment may contain more than 100 estimated homes; a longer road is split as
  needed while retaining every assigned address.
- Region boundaries and exact-segment exclusions remove whole segments from packet selection.
- Address data supplies estimated home counts and packet starting addresses. Retain the house
  number, street, available locality and postcode, and point coordinate for each address assigned
  to a normalized segment. Do not retain resident names, unit identifiers, or notes.
- The first release uses one deterministic global Overture pipeline for transportation segments,
  address points, and residential building footprints. Do not add city-by-city or county-by-county
  production integrations. Authoritative local data may be used only as a test reference.
- FEMA USA Structures may fill a displayed footprint gap only for a Single Family Dwelling that is
  not marked as an outbuilding. Accept either a direct match to a numbered Overture address within
  10 meters when no Overture footprint is within 10 meters, or the approved same-side row-gap rule:
  the FEMA polygon is not within 5 meters of an Overture footprint, has a numbered address within
  10 meters, is bracketed by nearby Overture homes on the same side of the named road, and passes
  the documented spacing, setback, area, and compactness limits. Deduplicate by FEMA building ID,
  retain match provenance, and omit unresolved candidates. A fallback paired with an already
  counted address improves the map but does not add another estimated home.
- Address assignment prefers a nearby matching street name, but name agreement is evidence rather
  than a hard requirement. An otherwise unmatched address may be assigned to an unambiguous nearby
  plausible residential road. Ambiguous addresses remain unmatched.
- Estimated homes begin with unique assigned addresses. A clearly residential Overture building
  may contribute one fallback home only when no address already accounts for it and its road
  assignment is unambiguous. Unknown and non-residential buildings do not contribute fallback
  homes.
- Overture apartment-class buildings, qualifying address premises, and explicit apartment
  residential land-use boundaries are apartment evidence, not automatically confirmed complexes.
  Apartment evidence does not increase adjacent street-segment estimates.
- An explicit apartment land-use boundary may propose one apartment site containing the evidence
  inside it. Nearby evidence is never grouped only because it is close. An administrator may keep a
  one-building site, group multiple buildings, or edit a site's membership. Grouping is an
  occasional correction tool, not a separately confirmed review state.
- Setup shows only `Not included` and `Included` for apartment sites. It does not expose `Needs
  setup`, `Packet ready`, a review status, building-grouping confirmation, or address confirmation.
- Inclusion requires a usable primary entrance/address, a positive administrator tract quantity,
  and explicit `Open` or `Restricted` access. Turning inclusion on also accepts the current building
  membership and address. Imported unit evidence and footprint calculations do not become the
  operational tract quantity.
- Apartment configuration and inclusion auto-save independently from Region Setup Save and Cancel.
  Clearing a required value automatically turns inclusion off. Editing building membership also
  turns inclusion off so the administrator can review the tract quantity before including the
  revised site again.
- V1 does not ask the administrator to name a complex. A source name may remain stored, but the
  starting address identifies the site when no source name is available.
- An included apartment complex receives its own packet and is never folded into a street packet.
  Apartment packets are atomic: taking one accepts the complete complex, and reconciliation later
  records one completion date for the complex.
- Included, unreserved apartment complexes participate in the requested packet count by heatmap
  age and the administrator-confirmed tract quantity; they are not appended beyond that count. A
  recently covered complex does not displace an older street or apartment candidate. An indivisible
  complex outside the normal packet-size tolerance remains atomic and is clearly flagged rather than
  split or silently orphaned. Restricted complexes may be included, but their packet carries a clear
  access warning.
- Imported street geometry and estimated home counts cannot be edited in the first release.
- A territory import retains every Overture feature classified as a road. High-confidence
  residential roads are active automatically; all other retained roads begin hidden.
- In Region Setup, an administrator can reveal hidden Overture segments and activate exact
  selected segments. Clicking selects one segment; additive clicks and rectangular selection may
  select multiple included, excluded, or revealed hidden segments at once.
- Administrator-activated segments remain active through later imports. A later source refresh may
  update matching geometry but cannot silently hide an approved segment; if the source segment
  disappears, Streetlight preserves the last approved geometry.
- Exact-segment selection is the first-release method for removing unsuitable streets. An
  administrator can exclude or restore one or more selected segments without deleting or changing
  imported geometry. The first release does not store or edit exclusion polygons.
- A manually excluded segment remains visible in gray and can be selected and restored. It does
  not contribute to region eligibility, tract totals, or packet generation while excluded.
  Segment exclusion and restoration follow Region Setup's explicit Save and Cancel model.
- A saved segment exclusion survives later imports while the exact imported segment still exists.
  A materially changed or replacement segment does not inherit the exclusion.
- Drawing roads, changing road geometry, deactivating an active segment, and correcting home
  counts are outside the first release.
- Completing a street packet records a coverage event for every included segment. Completing an
  apartment packet records one coverage event for the complex.
- Coverage history must be retained. Correcting a mistake records the correction instead of silently replacing history.

An administrator creates a region from an address, boundary distance, and either a circle or
square outer boundary, then reviews and adjusts the imported segments. The circle uses the selected
distance as its radius. The square uses the exact latitude-aware bounding box that encloses that
circle for the Overture import. The outer boundary is not reshaped as a freeform polygon. Segments
outside the selected boundary are not displayed. Gray segments are always inside the selected
boundary but excluded by exact-segment override. The administrator can exclude highways, commercial
districts, rivers, apartment complexes, areas assigned elsewhere, and other unsuitable locations.
Boundary distance is limited to one through five miles.

A territory save reuses imported streets and addresses whenever the proposed region's enclosing
square fits inside the saved import footprint. It imports again only when the proposed footprint
extends beyond stored geography or the pinned source-data contract requires an upgrade. Ordinary
exclusion, activation, exact-segment, boundary-shape, and contained boundary changes do not import.

An import-required save creates one persisted background job for the church and returns control to
the administrator immediately. An established church may keep using its prior saved region in
the other tools while the replacement is prepared; initial setup remains locked until its first
region is ready. Refresh reconnects to the job and shows truthful coarse stages. Success swaps in
the imported region atomically. Failure or interruption leaves the prior region and history
unchanged and allows a retry. Typical one-to-two-mile imports target about two minutes under ordinary
network conditions; Streetlight does not promise that time for every region or provider response.

Streetlight benchmarks its pinned Overture release and deterministic normalizer against varied
fixed US test territories. A holdout is high confidence at 95% address assignment, 99% road
representation, 98% correct road names, 90% segment-count accuracy, and zero severe outliers. It is
usable with warnings at 90% address assignment, 99% road representation, 90% correct road names,
85% segment-count accuracy, and no more than 3% severe outliers. Thresholds are inclusive, and the
severe-outlier percentage uses evaluated segments as its denominator.

The pinned global pipeline is acceptable for the pilot when every fixed holdout is at least usable
with warnings. High confidence remains the improvement target. A region that does not meet the
  high-confidence thresholds shows a persistent warning with concrete reasons in Setup and
Packets, but the administrator may continue without another confirmation modal. The
warning is not printed on volunteer packets. If a holdout falls below the usable floor, evaluate
the source data or a broadly applicable normalizer defect instead of adding regional production
imports or unmeasured heuristics.

The main map colors segments by time since last coverage:

- Red: oldest or never covered
- Orange: older
- Yellow: more recent
- Green: most recent

Each region stores the day when segments transition to yellow, orange, and red. The defaults are
90, 180, and 365 days. Administrators may edit those three ascending thresholds. The meaning and
order of the colors do not change, and never-covered segments are always red. The exact visual
palette remains a design decision. Heatmap ranges are a shared map setting: every tool that shows
the heatmap exposes the same settings control in the map legend instead of placing the editor in a
tool-specific sidebar.

## Packet generation

The administrator requests a number of packets and an approximate home count for each packet size.
A request can mix sizes, such as several smaller packets and several larger packets. The generator
automatically matches those requested sizes to suitable connected areas.

Streetlight generates compact, connected groups of street segments. Packets in one generated batch
may be scattered anywhere in the region, but each individual packet is one connected area.
Streetlight respects the region boundary, ignore zones, active reservations, and requested home
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
options does not reserve region streets. Reservations begin when the administrator finalizes a batch
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
- The church's centered printout message and optional reference. New churches default to
  `Ye are the light of the world.` with `Matthew 5:14`.

Place the QR code beside the printed starting address, visually group them, and indicate that the QR opens directions. Show the estimated homes/tracts prominently at the upper left. The map contains every selected street segment and one proposed starting-point marker. The Streetlight wordmark or logo appears only in the lower-left corner of the page, outside the map, the packet identifier appears opposite it in the lower-right corner, and the church-wide message sits between them as a quiet footer treatment when configured. An administrator may change or remove the message and reference in Setup; the setting applies to every later packet and cannot vary by batch. The page does not repeat the both-sides rule because that is part of the church's normal outreach process.

The first release does not include a written street list, address ranges, an individual-address list, a map legend, volunteer details, a proposed walking path, an end point, detailed navigation, or separate packet files.

After finalization, Streetlight automatically downloads the newly finalized batch. The
administrator can later download either the complete newest finalized batch or one combined PDF
containing every active packet across batches. The all-active download is ordered by oldest batch
first and preserves every packet's original identifier.

## Physical distribution

The administrator prints the batch and places each sheet with the matching number of tracts.

A volunteer takes one sheet and its tracts. Taking them means accepting responsibility for the entire packet. Streetlight has no partial-completion state because the church's process treats each packet as indivisible.

Finalized packets reserve their street segments or apartment complex so another packet cannot
include the same outreach unit. A sheet left available remains active and keeps its reservation
unless the administrator cancels it.

## Reconciliation

Reconciliation follows the physical table:

1. Streetlight shows every packet in the batch.
2. Every active packet starts unchecked, and the administrator checks the paper sheets that are
   still physically present.
3. Streetlight previews the unselected, missing sheets as completed.
4. The administrator confirms the update.
5. Streetlight records the current reconciliation date as the coverage date for every outreach
   unit in each completed packet.

The coverage date is the date the administrator reconciles the packet. It is not the batch creation
date or an estimated volunteer completion date. The server supplies the current date in the
church's time zone.

Sheets still present can remain active for a later outreach session or be cancelled. Active sheets
keep their reservations. Cancelling a sheet releases its segments or apartment complex back into
packet generation. Cancellation does not delete the packet or its history.

Administrators can undo an incorrect completion or change its date only as a whole packet.
Streetlight retains the original event and every correction. Undo restores all packet reservations
or none; it is rejected while any target is reserved by a newer active packet.

## Administrator dashboard

The first dashboard contains:

- Coverage heatmap
- Current estimated progress: a proportional distribution of eligible estimated homes across the
  saved heatmap colors, with the total estimated homes
- Number of active packets in Current Work
- Generate Batch action
- Reconcile Batch action

The distribution excludes ineligible streets and uses the same saved age ranges and coverage state
as the map. Each non-empty color band labels its estimated-home count at the band's midpoint.
Empty bands and duplicate day-range labels are omitted because the adjacent map legend explains
the colors. Labels that would overlap move down to the next available row while keeping their
guide lines anchored to the correct band. Coverage does not add a separate reporting-period
control.

For a signed-in configured administrator, the website uses one persistent map workspace at `/`.
Coverage, Packets, Outreach Progress, and Setup are tools in that workspace rather than separate
pages. Packets contains Generate and Reconcile as two views of the same paper workflow. Setup owns
both region configuration and church-wide printout settings.

The workspace's standard **Map** view uses MapLibre with Streetlight's approved pinned
OpenFreeMap/OpenMapTiles presentation, OpenStreetMap geography, persisted Overture/FEMA buildings,
and deterministic house-number placement. **Satellite** uses Google Maps JavaScript in labeled
hybrid mode and loads only after the administrator first selects it. Both renderers preserve one
camera and the same Streetlight overlays and editing state; changing the basemap must not change
application data or workflow behavior.

The interactive Map view and packet PDFs use the same shared open-data road widths, colors, and
street-label presentation. Packet-only framing, route highlights, attribution, and starting-point
layers remain print-specific.
Switching tools keeps
the map camera, Map/Satellite choice, and each tool's in-progress state. Coverage and Packets share
the complete heatmap; a selected packet adds a distinct review highlight and starting pin above
it. Setup replaces the heatmap treatment with its region-editing overlays when region
configuration is active.
The tool switcher is centered over the map canvas rather than the full page. Because it already
identifies the active tool, each right sidebar begins with its task content instead of repeating the
tool name in a second header.
Coverage places its region summary and map controls first. Its current-work continuation sits
at the bottom of the sidebar so it remains available without outweighing the map inspection tools.
The saved church location uses the founder-supplied church marker in every tool, and the header
uses the founder-supplied logo beside the `STREETLIGHT` text. A compact lower-right **Layers** card
opens the Map/Satellite chooser without loading a second map or static-map thumbnail.

Advanced charts, leaderboards, volunteer statistics, and a report builder are outside the first release.

## Outreach progress

Streetlight includes a separate **Outreach Progress** tool for reflection and church presentation.
It is optional and does not interrupt the recurring Coverage and Packets workflow.

The administrator view contains a simplified progress map, a selected time period, factual metrics
derived from Streetlight's existing records, a static print action, and a control that launches
presentation mode. Appropriate metrics include completed packets, covered street segments, and
estimated homes reached. Streetlight does not infer people reached, spiritual outcomes, volunteer
performance, or other claims it cannot observe.

Presentation mode is a calm, unattended full-screen composition suitable for leaving on a church
TV or display. It contains no administrative controls and requires no one to click through a
dashboard. Its default yearly playback is cumulative: a street lights up when its recorded outreach
occurs and remains lit for the rest of the playback, allowing the congregation to see outreach
spread across the region and be encouraged by its steady work. It rests on the completed view,
then repeats gently. The operational heatmap remains separate and continues to show time since last outreach.

The first version does not include a report builder, rankings, volunteer statistics, a public
sharing link, or video export. Full-screen presentation and the static print view use the same
underlying progress composition.

## First release scope

Included:

- Administrator authentication
- Invite-only access requests and founder-managed approval
- Public How it works, Why Streetlight, and Pricing pages
- Plain-language church access status in the administrator account
- Church administrator list, invitation, pending-invitation revocation, and removal
- Church workspace setup
- Region creation and correction
- Editable region boundary shape and distance
- Reversible exact-segment exclusions
- Coverage heatmap
- Outreach progress map, cumulative yearly presentation mode, and static print view
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
- Social login
- Volunteer accounts
- Multiple regions or campuses
- Custom permission roles
- Native mobile applications
- Advanced reporting
- Email delivery of packets
- Individual household records or notes
- Manual correction of imported street geometry or estimated home counts
- Partial packet completion
- AI of any kind

## Pricing direction

Before the founder church receives the hosted application, Streetlight publicly presents one paid
plan at **$149 per year** or **$15 per month**. Annual billing appears first. The amounts remain
subject to an explicit founder revision after real pilot cost and support evidence, but Streetlight
does not imply that the product is generally free while that evidence is collected.

Every ordinary approved church receives a 90-day full-product free trial with no credit card
required. A church may optionally choose a subscription during the trial; its first charge begins
when the trial ends, and cancelling before then owes nothing. There is no permanent public free
plan, feature tier, packet quota, home-count limit, or administrator limit. Data-integrity and
correction behavior never depends on access type.

The founder church receives **Founding church access**. Its account states exactly:

> **Founding church access**
>
> Streetlight is provided to your church at no cost. No payment is required.

The public landing page contains no pricing section. Once How it works and Why Streetlight are
available, navigation links to a separate Pricing page containing the annual and monthly prices,
trial terms, email-support boundary, FAQs, and a signed founder note with a photograph. Follow the
approved [`Public site, trial, and subscription experience`](docs/superpowers/specs/2026-08-04-public-site-trial-subscription-design.md).

Pricing and access presentation precede the founder-church handoff. Payment collection,
subscription automation, trial expiration, and paid access enforcement remain excluded until the
product works for the founder church and the founder explicitly starts that later work.

## Approved pilot architecture

The founder-church pilot uses the smallest operational stack that supports the existing application:

- Railway Hobby hosts one application container under its generated HTTPS domain. The container
  runs the Next.js application and the existing Python/DuckDB Overture importer.
- SQLite remains the application database on one Railway persistent volume. Railway volume backups
  are the pilot backup mechanism.
- WorkOS AuthKit provides invite-only email/password authentication, persistent sessions,
  invitation emails, and one organization per church. Use the standard WorkOS domain during the
  pilot; do not purchase its custom-domain add-on.
- The primary interactive street map uses MapLibre with Streetlight's pinned
  OpenFreeMap/OpenMapTiles style, OpenStreetMap geography, Overture building footprints, and
  eligible FEMA USA Structures fallbacks. Selecting Satellite lazily initializes Google Maps
  JavaScript in labeled hybrid mode; after its first use, keep that map instance mounted and reuse
  it across Map/Satellite toggles. Ordinary map viewing must not load Google Maps. Both modes
  preserve the same camera and Streetlight overlays.
- Printable packet maps use the same pinned open-data cartography and never use Google imagery.
  Google remains the provider for geocoding, road snapping, satellite viewing, and the printed
  directions QR code. Configure Google API quotas before deployment.
- Enable Railway sleeping where compatible and set a hard spending limit. Use the generated Railway
  domain until the founder church approves the pilot; `streetlight.church` remains a possible later
  purchase.
- Do not add Supabase, R2, Resend, Redis, a separate worker provider, or a separate database service
  for the pilot.

Keep the importer in the application deployment until imports measurably interfere with normal
requests. Move SQLite to PostgreSQL only when Streetlight needs multiple application replicas,
database locking or import performance becomes a measured problem, the database approaches the
Railway Hobby volume limit, stronger recovery is required, or the pilot grows beyond roughly 10–20
active churches.

## Technical decisions left open

The following are implementation choices, not founder decisions:

- Application framework and repository layout
- Database and geospatial extensions
- Any commercial address-data fallback required only if the approved global Overture pipeline
  fails its benchmark
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
