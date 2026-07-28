# Phase 5 batch finalization and PDF design

Status: founder approved  
Approved: July 28, 2026  
Product authority: [`PRODUCT.md`](../../../PRODUCT.md)  
Phase authority: [`IMPLEMENTATION_PLAN.md`](../../../IMPLEMENTATION_PLAN.md)

## Goal

Turn the read-only packet proposals from Phase 4 into one durable batch, reserve every included
street segment atomically, and produce the founder-approved printable packet pages.

Phase 5 ends when a finalized batch can be downloaded again without changing its stored data and
the founder approves a physically printed page.

## Founder decisions

- The primary action is **Finalize & download**.
- Finalization succeeds or fails as one database transaction.
- A PDF failure never rolls back a successfully finalized batch.
- Streetlight creates an automatic date-and-time batch name in the church time zone.
- The administrator may enter an optional custom batch name for a special event.
- After finalization, the two download choices are:
  - **Download newest batch**
  - **Download all active packets**
- The newest-batch download contains the complete most recently finalized batch.
- The all-active download contains every packet whose status is `active`, across batches, ordered
  by oldest batch first and then by original packet order.
- Every packet keeps its original stable identifier in every later download.
- The PDF uses the approved Phase 0 US Letter layout and the TypeScript server pipeline described
  below. The Python proof and headless-browser rendering are not production dependencies.

## Scope

Phase 5 includes:

- proposal finalization;
- durable batches, packets, and packet-segment reservations;
- stable packet identifiers and stored starting coordinates;
- optional custom batch naming;
- newest-batch and all-active PDF downloads;
- Google Roads snapping and Google Static Maps rendering on the server;
- navigation QR generation;
- repeat downloads without database mutation;
- the existing active-packet dashboard count updating after finalization.

Phase 5 does not include:

- moving segments between proposals;
- editing a finalized packet;
- cancelling packets;
- marking packets completed;
- reconciliation;
- individual packet reprint controls;
- a batch-history browser;
- storing generated PDFs or Google-snapped coordinates;
- email delivery or volunteer access.

## Administrator workflow

The current Phase 4 proposal form and map remain the review surface. Once proposals exist, the
sidebar adds:

- an optional **Batch name** field; and
- a primary **Finalize & download** button.

Blank batch names use an automatic label such as
`Outreach batch — July 28, 2026, 7:30 PM`. A custom value replaces that display label but does not
change packet identifiers.

Before finalization, a confirmation summarizes:

- packet count;
- total estimated tracts; and
- that finalization reserves the selected streets.

After a successful confirmation:

1. Streetlight finalizes the batch and refreshes coverage totals.
2. The new batch remains highlighted on the shared map.
3. Streetlight automatically downloads the new-batch PDF.
4. The sidebar shows a success state with **Download newest batch** and
   **Download all active packets**.

The same two download choices remain available after a reload. If the automatic download fails,
the success state says that the batch was finalized and leaves both download actions available.

## Finalization contract

The browser cannot supply trusted packet geometry, tract counts, starting points, or arbitrary
segment identifiers.

The finalization request contains:

- the original packet-size requests;
- the fingerprint of the exact proposals shown to the administrator; and
- the optional custom batch name.

Inside one write transaction, the server:

1. Regenerates the deterministic Phase 4 proposals from the current database state.
2. Computes their stable fingerprint.
3. Rejects the request if the fingerprint differs from the reviewed proposals.
4. Rechecks that every segment is eligible and unreserved.
5. Creates one finalized batch.
6. Creates each packet with its stable code, tract estimate, starting address, and starting
   longitude and latitude.
7. Creates every packet-to-segment row in stable packet order.

Any error rolls back the complete transaction. A stale proposal, double submission, or competing
reservation returns a conflict response and tells the administrator to regenerate. It never
creates a partial or duplicate batch.

## Persistence

The existing `batches`, `packets`, and `packet_segments` tables remain the core model. The smallest
schema addition stores the finalized starting point coordinates and any sequencing data required
for stable automatic packet codes.

Finalized packet rows retain:

- batch ownership;
- stable packet code;
- starting address;
- starting coordinate;
- estimated homes/tracts;
- active status; and
- the ordered selected segment IDs.

Street geometry remains referenced through `packet_segments`. Existing import behavior already
preserves geometry referenced by finalized packets when a later Overture import retires a segment.

No PDF or rendered map image is stored in SQLite. Downloads are generated from the saved immutable
packet assignment. Re-downloading does not create batches, packets, reservations, or coverage
events.

## Download scopes

**Newest batch** selects the batch with the latest `finalized_at`; a stable ID breaks an otherwise
equal timestamp. It includes that batch's packets in original packet order.

**All active packets** selects every packet with status `active`, including active packets that may
later remain from a reconciled batch. It orders packets by batch finalization time from oldest to
newest, then by original packet order.

An empty scope returns a clear no-packets response rather than an empty PDF.

## PDF pipeline

The web server uses a small TypeScript PDF library and QR encoder. It does not invoke Python or a
headless browser.

For each packet, the server:

1. Loads the finalized segment geometry and stored starting coordinate.
2. Snaps the selected road geometry through Google Roads using bounded requests.
3. Requests one Google Static Maps image containing all snapped segment highlights and Google's
   standard unlabeled starting marker.
4. Creates the Google Maps directions URL for the stored starting address.
5. Encodes that URL as the navigation QR.
6. Draws one US Letter page.

The complete PDF is assembled before the response begins. If any page cannot be rendered, the
request returns an error and no partial PDF bytes.

Google credentials remain server-only. Snapped Google geometry is not persisted. Each repeat
download may therefore use new Google Roads and Static Maps requests.

## Packet page

Every packet occupies exactly one US Letter page:

- prominent estimated homes/tracts at the upper left;
- compact starting-address panel and navigation QR at the upper right;
- Google map across most of the page;
- every selected segment highlighted with the approved centered orange stroke;
- one Google standard unlabeled starting pin;
- required Google map attribution;
- Streetlight icon and wordmark at the lower left; and
- stable packet identifier at the lower right.

The page does not contain the batch name, map legend, street list, address ranges, individual
addresses, walking path, walking order, end point, volunteer details, or repeated instructions.

## Error behavior

- Invalid packet requests or custom names return validation errors without writes.
- A changed proposal or newly reserved segment returns a conflict and requires regeneration.
- Database errors expose no partial batch.
- Google Roads, Static Maps, QR, or PDF failures leave finalized data and reservations intact.
- Download failures present a retry action without silently finalizing again.
- No map API key, provider URL, or provider response containing credentials reaches the browser.

## Verification

Automated checks must prove:

- previewing proposals writes nothing;
- finalization creates exactly one batch and all packets and reservations in one transaction;
- stale, conflicting, and repeated finalization attempts create no partial or duplicate records;
- finalized segments are unavailable to later packet generation;
- automatic and custom batch names persist;
- starting addresses and coordinates persist;
- newest-batch and all-active scopes select and order the correct packets;
- repeat downloads make no database changes;
- PDF page count equals packet count;
- every page contains the correct packet code, tract count, starting address, QR destination, map,
  and selected segment highlights;
- provider failure produces no partial PDF and does not undo finalization; and
- the production build, TypeScript, Biome, Node tests, importer tests, and `git diff --check` pass.

The browser check finalizes a real Temecula batch, confirms reservations and the active-packet
count, downloads both scopes, reloads, and downloads them again. The human checkpoint scans the QR
code, checks the map and metadata, and physically prints one page.
