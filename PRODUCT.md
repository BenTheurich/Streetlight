# Streetlight product ground truth

Status: approved founder direction  
Approved: 2026-07-27

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
| Packet | One printed route sheet plus the matching number of tracts. |
| Batch | A group of packets finalized and printed together. |
| Active packet | A finalized packet whose street segments remain reserved. |
| Completed packet | A packet whose paper sheet was taken and later recorded as completed during reconciliation. |
| Last covered | The most recent reconciliation date recorded for a street segment. |
| Ignore zone | An area excluded from packet generation. |
| Priority zone | An area preferred during packet generation, subject to coverage age and packet constraints. |

## Coverage model

The tracked coverage unit is a short street segment rather than an individual household.

- A segment normally includes residential homes on both sides of the street.
- A territory boundary or ignore zone can exclude one side or part of a segment.
- Address data supplies estimated home counts and packet start and end addresses.
- Completing a packet records a coverage event for every included segment.
- Coverage history must be retained. Correcting a mistake records the correction instead of silently replacing history.

An administrator creates a territory from an address and radius, then adjusts the resulting boundary. The administrator can exclude highways, commercial districts, rivers, apartment complexes, areas assigned elsewhere, and other unsuitable locations.

The main map colors segments by time since last coverage:

- Red: oldest or never covered
- Orange: older
- Yellow: more recent
- Green: most recent

The exact time thresholds and visual palette remain design decisions. The meaning and order of the colors do not.

## Packet generation

The administrator requests a number of packets and an approximate home count for each packet size. A request can mix sizes, such as several smaller packets and several larger packets.

Streetlight generates compact, connected groups of street segments. It prioritizes the oldest eligible segments while respecting the territory boundary, ignore zones, active reservations, and requested home count.

A packet contains a proposed walking order. It is guidance rather than a requirement. Taking the packet commits the volunteer to cover every highlighted segment, regardless of the order walked.

Route behavior:

- Prefer a loop or an end point near the start because a volunteer may park there.
- Allow a different end point when it produces a better packet.
- Show numbered segments, directional arrows, and start and end markers.
- Do not print written turn-by-turn directions.
- Print the starting address and ending address.
- Include a QR code that opens the starting address in Google Maps.
- The QR code is for navigation only. It does not open Streetlight, identify a volunteer, or report completion.
- Print the starting address as text so the packet remains usable without scanning the QR code.

Previewing packet options does not reserve territory. Reservations begin when the administrator finalizes a batch for printing.

## Printed output

A finalized batch downloads as one multi-page PDF. Each packet occupies exactly one page.

Each packet page contains:

- Packet identifier
- Batch name
- Map with highlighted street segments
- Numbered proposed walking route
- Start and end markers
- Starting address
- Ending address
- Google Maps QR code for the starting address
- Written list of included streets or address ranges
- Estimated home count and number of tracts needed
- Small map legend

The first release does not include an individual-address list, volunteer details, written turn-by-turn directions, or separate packet files.

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

Advanced charts, leaderboards, volunteer statistics, and a report builder are outside the first release.

## First release scope

Included:

- Administrator authentication
- Church workspace setup
- Territory creation and correction
- Editable territory boundary
- Ignore zones
- Coverage heatmap
- Deterministic packet generation
- Batch preview and finalization
- Packet reservations
- Multi-page PDF generation
- One-page packet layout
- Printed start and end addresses
- Google Maps navigation QR code
- Proposed walking route
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
- Map, address, geocoding, and routing providers
- Hosting provider
- PDF rendering method
- Payment provider
- Exact packet-generation algorithm
- Heatmap time thresholds
- Logo, typography, and final visual design

Choose the smallest stack that supports a hosted multi-church service, deterministic geospatial work, printable packets, backups, and low operating cost. Do not preserve an existing dependency or service merely because it appears in the repository.

## Existing repository status

The repository at the time of approval contains a Next.js web shell, a NestJS API shell, partial Clerk authentication, deployment files for Vercel and Fly.io, one brand test, and one undiscovered API health test.

It contains no database schema, territory model, map, address import, packet generator, routing logic, PDF generator, reservation model, reconciliation flow, or Streetlight domain data.

The current scaffold is not a product implementation and is not production-ready. Its frameworks, authentication flow, deployment targets, and monorepo structure can be replaced. Preserve the Git repository and history as an archive, but begin the product implementation from the ground truth in this document.

## Change control

Future agents and contributors must:

1. Read this document before planning or changing product behavior.
2. Distinguish approved product rules from provisional pricing and open technical choices.
3. Keep volunteers outside the application workflow.
4. Keep the core product deterministic and AI-free.
5. Ask for a founder decision before changing a product rule.
6. Update this document when the founder approves a product change.
