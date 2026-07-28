# Streetlight implementation plan

Status: approved execution sequence  
Product authority: [PRODUCT.md](PRODUCT.md)

## Purpose

This document divides Streetlight into numbered, testable phases. A user can ask an AI coding agent to "work on Phase 4," and the agent should have enough scope, dependencies, acceptance criteria, and review instructions to complete that phase without redefining the product.

`PRODUCT.md` defines what Streetlight must do. This document defines the order in which to build it. If the two conflict, `PRODUCT.md` wins.

## Phase workflow

Work on one phase at a time:

1. Read `PRODUCT.md`, `AGENTS.md`, and this document.
2. Confirm that every dependency phase is marked `Complete`.
3. Change the requested phase to `In progress`.
4. Inspect the current code before choosing an implementation.
5. Implement only the requested phase and fixes required to make it work.
6. Add the smallest automated checks that would catch a broken implementation.
7. Run the repository's canonical checks.
8. Use a real browser for user-interface acceptance checks.
9. Update the phase status and evidence.
10. Stop and give the founder the listed human-review steps.

Do not begin the next phase until the founder approves the current phase. Do not add features from later phases for convenience.

## Status values

- `Pending`: Work has not started.
- `In progress`: An agent is working on the phase.
- `Awaiting human review`: Automated checks pass and the founder has review steps.
- `Complete`: The founder approved the phase.
- `Blocked`: A named decision, credential, data source, or external service prevents further work.

## Phase status

| Phase | Name | Depends on | Status | Evidence |
|---:|---|---|---|---|
| 0 | Geographic and print proof | None | Complete | [Phase 0 proof](phase0/README.md): founder approved the geographic providers, four map examples, starting points, estimates, QR behavior, and final one-page US Letter layout on July 27, 2026; 9 automated checks pass |
| 1 | Application foundation | Phase 0 | Complete | Founder confirmed the local application loads on July 27, 2026; one Next.js 16.2 application and SQLite database replace the abandoned web/API/auth scaffold; migration and idempotent pilot seed cover all eight initial domain records; frozen install, migration, seed, lint, typecheck, integration test, production build, and local browser check pass |
| 2 | Territory setup | Phase 1 | Complete | Founder approved the interactive territory setup, Overture import quality controls, hidden-road activation, toggleable polygon and exact-segment exclusions, and circle/square boundaries on July 28, 2026; 59 Node checks, 25 Python checks, lint, typecheck, production build, and browser review pass |
| 3 | Coverage history and heatmap | Phase 2 | Complete | Founder approved the full imported-territory heatmap and merged it on July 28, 2026; 84 Node checks, 25 Python checks, lint, typecheck, production build, database invariants, and real-browser acceptance pass. |
| 4 | Packet selection | Phase 3 | Complete | Founder approved the deterministic packet proposals and orphan-prevention behavior and merged Phase 4 locally on July 28, 2026; automated, canonical-data, and browser evidence is recorded below |
| 5 | Batch finalization and PDF | Phase 4 | Complete | Atomic finalization, stable packet reservations, newest/all-active downloads, and map-first Letter PDFs are implemented; 119 Node checks, 26 Python checks, Biome, TypeScript, production build, isolated-browser finalization/reload, rendered-PDF inspection, and founder review pass |
| 6 | Reconciliation and corrections | Phase 5 | Pending | None |
| 7 | Authentication and church isolation | Phase 6 | Pending | None |
| 8 | Deployment and recovery | Phase 7 | Pending | None |
| 9 | Founder-church pilot | Phase 8 | Pending | None |

## Phase 0: Geographic and print proof

### Goal

Prove that available geographic data can support Streetlight before rebuilding the application.

### Agent work

- Accept a test church address and radius supplied by the founder.
- Identify the smallest suitable sources for street geometry, residential addresses, and map display.
- Load the test area and normalize it into short street segments.
- Estimate residential home counts for the segments.
- Generate one compact sample packet that favors connected segments.
- Choose a valid starting address.
- Highlight every selected segment using its road geometry and mark the proposed starting point.
- Generate a one-page sample PDF containing the required packet fields.
- Generate a navigation QR code that opens the starting address in Google Maps.
- Record provider limits, attribution requirements, licensing constraints, and expected operating costs that would affect the product.

This phase is a proof, not the application. Do not add authentication, billing, dashboards, or a reusable service layer.

### Automated checks

- The same saved input produces the same normalized segments and sample packet.
- Normalization preserves the first and last coordinates of selected geometry.
- Every packet segment lies inside the requested area.
- Every selected segment represents both sides of its street.
- Home counts are non-negative.
- The starting address belongs to the packet area.
- The QR payload contains the expected Google Maps destination.
- The PDF contains one page and the required text fields.

### Human review

The founder:

- Compares the map against streets they know.
- Checks whether residential home counts are credible.
- Confirms that every highlight follows the road and means covering both sides.
- Opens the QR code on a phone.
- Prints the PDF and checks map labels, segment highlights, starting address, and tract count.
- Approves the geographic providers before they become application dependencies.

### Completion condition

The founder approves the sample area and printed packet, and the repository records the accepted data sources and constraints.

## Phase 1: Application foundation

### Goal

Replace the abandoned scaffold with the smallest deployable application that can support the approved geographic proof.

### Agent work

- Choose one full-stack web application and one database unless Phase 0 proves a separate process is required.
- Remove or replace the existing Next.js, NestJS, Clerk, Fly.io, and Vercel scaffold where it does not serve the selected architecture.
- Preserve `PRODUCT.md`, `IMPLEMENTATION_PLAN.md`, `AGENTS.md`, and Git history.
- Add versioned database migrations.
- Add the initial records: church, administrator, territory, street segment, coverage event, batch, packet, and packet segment.
- Include church ownership on all church data from the first migration.
- Add local seed data without adding public signup or production authentication.
- Document one canonical command for install, lint, typecheck, test, build, migrate, and local development.

Phases 1 through 6 remain local-only. Do not deploy an unauthenticated application.

### Automated checks

- A clean checkout installs with the documented command.
- Database migrations apply to an empty database.
- Seed data loads.
- The application starts.
- Lint, typecheck, tests, and production build pass without third-party credentials.
- A database integration check creates a church, territory, segments, batch, and packet.

### Human review

The founder receives one local URL and confirms that the application opens. No design approval is required beyond a usable shell.

### Completion condition

The clean-checkout checks pass, the founder opens the local application, and the old scaffold is no longer presented as production code.

## Phase 2: Territory setup

### Goal

Create and correct one church outreach territory.

### Agent work

- Accept a church address, boundary distance, and circle or square boundary shape.
- Import and display the street segments proven in Phase 0.
- Normalize and store street geometry and residential home counts for the complete Overture
  bounding-box footprint.
- Continue road geometry through Overture connector points and slight bends, splitting at turns
  of about 90 degrees or as needed to cap every normalized segment at 100 estimated homes.
- Display the territory in an interactive Google Maps JavaScript API map.
- Allow the administrator to switch between the circle and its exact enclosing Overture bounding
  box and adjust the shared distance with live controls.
- Allow the administrator to create, name, reshape, and remove polygon exclusion zones.
- Allow each exclusion zone to be enabled or disabled without deleting its saved geometry.
- Do not display segments outside the selected outer boundary.
- Display eligible segments inside the boundary in the page accent color and excluded segments
  inside the boundary in gray.
- Retain every imported Overture road as active or hidden.
- Automatically activate high-confidence residential roads.
- Allow the administrator to preview and activate a complete hidden road group.
- Preserve administrator activations through later imports.
- Allow the administrator to exclude and restore one exact segment without deleting its imported
  geometry.
- Treat imported segment geometry and home counts as non-editable.
- Persist all changes.

### Automated checks

- Imported segments belong to the correct church.
- Segments not entirely inside the selected circle or square are omitted from the map and totals.
- Gray segments are inside the selected boundary and excluded by a polygon or exact-segment
  override.
- Any segment that touches or crosses an exclusion polygon is excluded from eligible home totals.
- Boundary shape, boundary distance, and exclusion-polygon changes persist after reload.
- Disabled exclusion polygons remain stored but do not affect eligibility totals.
- Saving a deletion removes only the selected exclusion.
- Cancelling draft changes leaves the stored territory unchanged.
- Hidden-road activation selects the complete deterministic road group.
- A saved manual activation remains active after a later import.
- A saved segment exclusion affects only the exact selected segment and survives a reimport only
  while that segment's geometry remains unchanged.
- Restoring a segment does not override the outer boundary or an enabled exclusion polygon.
- Switching between circle and square within the imported footprint does not trigger another
  import.
- Failed imports preserve the prior active and hidden road sets.
- Territory totals equal the eligible segment totals.

### Browser check

Create a territory, switch between circle and square, adjust its distance, draw and reshape an
exclusion polygon, save, reload the page, and verify that the same map and totals return. Confirm
that outside-circle segments disappear rather than turning gray and that cancelling a second set
of changes restores the saved territory. Confirm that address evidence activates Hillsdale
Heights, then show hidden roads, activate another known candidate, save, reload, and verify that
the complete road remains active after another import. Select one orange segment, exclude it,
verify that only its tracts leave the totals, save and reload, then select the gray segment and
restore it.

### Phase 2 evidence

Verified July 28, 2026 with pinned Overture release `2026-06-17.0`:

- The 1-mile website import returned 687 segments and 3,368 estimated homes at
  `2026-07-27T20:20:53.002209+00:00`; 487 segments and 2,635 homes were eligible before
  exclusions.
- Restart persistence passed. Saving an exclusion reused the import timestamp. Expanding to
  1.1 miles replaced the set with 769 segments and 3,880 homes at
  `2026-07-27T20:30:01.764126+00:00`; reducing back to 1 mile reused that footprint.
- An invalid importer executable preserved the complete 1.1-mile browser draft and left the
  saved 1-mile radius, exclusion, timestamp, and 687-segment set unchanged after reload.
- Real Chrome checks passed the approved orange/gray styling and legend, broad/close label
  readability and stroke scaling, first-point visibility, one/two-point dragging, map/vertex
  cursors, self-crossing rejection, gray live previews, save/reload/cancel, and geographically
  fixed polygons after an address change.
- Reimport now retires prior segment rows instead of deleting them. Focused database checks
  preserve coverage and finalized-packet references while workspace and summary reads expose
  only the exact current imported set.
- Sidebar vertex controls move both partial-drawing and selected saved-polygon vertices with
  arrow keys through the same live geometry callbacks. Unfinished drawing points now trigger
  the unsaved-navigation warning.
- The July 28 amendment retains all 6,373 Overture road segments in the 1.9-mile import:
  1,916 are automatically active and 4,457 remain hidden for administrator review. Hillsdale
  Heights is one automatic four-piece group with 28 estimated tracts.
- Browser checks passed hidden-road display, complete-group selection, draft activation,
  cancellation, explicit save, and persistence after reload. Rita Way persisted as a two-piece
  manual activation, and the browser reported no errors or warnings.
- Exclusion-area review added explicit enabled checkboxes and visible Delete actions. Disabling the
  saved test polygon restored 20 segments and 102 tracts in the live draft; Save/reload preserved
  both states, Cancel restored toggles and draft deletion, and the disabled polygon remained
  selectable as a faint gray outline.
- Exact-segment review excluded one six-tract Rose Arbor Court segment without changing its
  adjacent same-name segments. Eligible totals changed from 1,553 segments and 8,715 tracts to
  1,552 and 8,709, Save/reload preserved the clickable gray segment, Restore reversed it, and
  Cancel reinstated the saved exclusion. The local test territory was restored afterward.
- The circle/square amendment imports and normalizes the complete enclosing Overture bounding box
  once. At 1.9 miles, the saved test data contains 14,833 addresses, of which 10,663 matched a
  road. The square preview showed 10,343 eligible tracts across 1,845 segments; the circle preview
  hid the corner geometry and showed 8,727 eligible tracts across 1,553 segments.
- Normalizer version 6 removes connector-only boundaries while retaining the 85-degree turn rule
  and enforcing a hard 100-home maximum. On the saved 1.9-mile footprint it reduced 6,440
  normalized segments to 3,993 while preserving all 10,932 assigned homes; the largest resulting
  segment contained 48 homes.
- Browser checks passed live shape switching, complete-boundary rendering, shape persistence after
  reload, no reimport when switching within the saved footprint, and Cancel restoration. The saved
  local territory was returned to its original circle afterward.
- Biome, TypeScript, 59 Node tests, 25 Python importer tests, the Next.js production build, and
  `git diff --check` pass. The final browser session reported no errors or warnings.

### Human review

The founder inspects the area around the church, switches between circle and square, adjusts the
boundary distance, and confirms that segments outside the selected boundary are not displayed.
The founder draws a known exclusion and confirms that affected segments turn gray and disappear
from eligibility. The founder then confirms that Hillsdale Heights is active, shows hidden roads,
activates a known uncertain road, saves, reloads, and confirms that the road remains active. The
founder then clicks one orange segment, excludes and saves it, reloads, and confirms that the same
gray segment can be restored.

### Completion condition

The founder can make the stored territory match the church's real outreach area by selecting a
circle or square boundary, adjusting its distance, drawing exclusion polygons, activating retained
Overture roads, and excluding or restoring exact individual segments without editing the database.

## Phase 3: Coverage history and heatmap

### Goal

Record outreach coverage and display its age on the map.

### Agent work

- Record append-only coverage events for street segments.
- Calculate each segment's last-covered date from valid events.
- Display never-covered and older segments in red, followed by orange, yellow, and green for more recent coverage.
- Define and document initial time thresholds as implementation defaults.
- Display total estimated homes, homes covered during a selected period, and active-packet count.
- Allow an administrator to correct or undo a coverage event while retaining the correction history.

### Automated checks

- A fixed set of events produces the expected last-covered dates and color classes.
- Never-covered segments use the oldest class.
- A correction changes the visible result without deleting the original event.
- Dashboard totals match the underlying eligible segments and events.

### Browser check

Load seeded events, inspect every heatmap color, change the selected period, correct one event, and confirm the map and totals update.

### Phase 3 evidence

- The rebased Phase 3 diff passes Biome lint, TypeScript, 75 Node tests, 25 Python tests, the
  Next.js production build, and `git diff --check`. Independent whole-diff review found no
  Critical issues; every Important finding was resolved before publication.
- The post-rebase fixes assign coverage migrations 010 and 011 after Phase 2's migrations through
  009, omit hidden and out-of-boundary roads from Coverage, retain in-boundary exclusions in gray,
  keep excluded history selectable and correctable, and use the pilot church's local calendar date.
- The isolated `coverage-demo.db` seed is recreated twice with stable counts: 8 coverage events,
  1 finalized batch, 1 active packet, and 1 packet-segment link. At `2026-07-28`, literal
  30/90/180/365-day totals are 5/21/27/28 homes; the demo contains green, yellow, orange, red,
  never-covered, corrected, and undone roots.
- Route tests prove date correction, undo, restore, and malformed/future/unknown/
  completion-shaped/extra-key no-mutation behavior. The normal seed remains free of demo coverage,
  batches, packets, and packet-segment links.
- A real browser loaded the built app and Google map with all four heatmap colors, changed the
  90-day metric from 21 homes to the expected 5 homes at 30 days, selected a gray exact-exclusion
  with retained history, undid and restored its completion, confirmed persistence after reload,
  opened Territory Setup, and reported no console errors.
- The July 28 heatmap-settings amendment adds migration 012 and saves strictly ascending yellow,
  orange, and red transition days per territory. The legend now states the resulting day ranges;
  never-covered remains red and the selected-period metric is unchanged. Focused route tests prove
  valid persistence and invalid-request no-mutation behavior.
- The complete Phase 2 Overture database was recovered into the main checkout after ignored backups
  were created for both database files. Before and after recovery it contains release
  `2026-06-17.0`, generation 3, 14,833 imported addresses, 10,663 assigned homes, 6,373 current
  segments (1,938 automatic, 4,431 hidden, and 4 manually activated), and the same disabled
  exclusion polygon. Legacy coverage migration names were mapped to migrations 010 and 011 only
  after their complete columns, indexes, and triggers exactly matched a fresh main schema after
  whitespace normalization.
- The amendment passes 84 Node checks, Biome, TypeScript, and the Next.js production build. A real
  browser loaded the canonical database with 8,727 eligible tracts across 1,553 visible segments,
  saved custom 91/181/366-day transitions, confirmed the new ranges after reload, rejected invalid
  ordering without persistence, restored the 90/180/365 defaults, and loaded Territory Setup with
  the 10,663-of-14,833 address-match summary and hidden-road controls intact.
- The isolated demo now copies the complete canonical import and applies deterministic geographic
  30-, 120-, 240-, and 500-day bands while leaving the far edge never covered. Browser review
  showed all 1,553 visible segments with balanced heatmap colors, range-only legend labels, the
  `Demo data` indicator, and no console errors.

### Human review

Start the canonical application with `pnpm --dir web dev` and open `http://localhost:3000`. Confirm
the recovered territory streets appear, save valid heatmap ranges, reload, verify invalid ordering
is rejected, and open Territory Setup to inspect hidden-road and exclusion controls.

Optionally run `pnpm --dir web coverage:demo` at `http://localhost:3001` to inspect every heatmap
color and history state. The page must be visibly labeled `Demo data`; changing demo dates or
ranges must not affect the canonical database.

### Completion condition

Coverage events, corrections, colors, and dashboard totals pass their checks and the founder approves the map.

## Phase 4: Packet selection

### Goal

Generate deterministic packet proposals from eligible street segments.

### Agent work

- Accept requested packet quantities and approximate home counts.
- Follow the approved
  [`Phase 4 packet proposal design`](docs/superpowers/specs/2026-07-28-phase4-packet-proposals-design.md).
- Protect the oldest eligible segment as each packet's seed, use same-range connected streets first,
  and cross into newer ranges only as needed to make that seed viable.
- Prefer compact, connected segment groups and automatically match mixed requested sizes to the
  geography.
- Target plus or minus 30 percent without splitting segments; absorb attached small branches when
  doing so prevents an unusable remainder and remains within the upper bound.
- Recognize true T-junctions and conservative same-name continuation gaps in the packet graph.
- Return fewer proposals with a cleanup explanation instead of silently skipping an old segment or
  filling request slots with arbitrary tiny packets.
- Exclude segments outside the territory boundary, touching or crossing exclusion areas, or
  reserved by active packets.
- Prevent a segment from appearing in two proposed packets in the same generation.
- Produce selected segments, a proposed starting address, an admin-only street summary, and an
  estimated tract count.
- Retain assigned address points during import and apply the approved terminal-address fallback.
- Keep proposals read-only and unreserved.
- Use a small deterministic heuristic focused on segment grouping. Do not build a route-optimization platform.

### Automated checks

Use one fixed synthetic street graph and one saved real-area fixture.

- Repeated runs produce the same packets.
- The oldest eligible segment anchors each packet and newer ranges fill it only when necessary.
- An all-red territory expands outward from the church.
- Every selected segment is eligible.
- No segment appears twice.
- Packet home counts are calculated from their segments.
- Normal proposals meet the target tolerance, orphan prevention is deterministic, and viable
  normal candidates outrank arbitrary tiny components.
- T-junctions and conservative same-name gaps connect without joining unrelated roads.
- Every packet segment appears in the proposal map.
- The proposed starting address belongs to the packet and follows the fallback order.

### Browser check

Generate mixed packet sizes, inspect each proposal on the map, regenerate the same request, and confirm the output does not change.

### Implementation evidence

- Tasks 1-4 were committed as `942e060`, `9c60567`, `1ee7f5d`, and `8ed89ee`; focused review
  warning fix: `e7411bf`.
- 26 Python importer tests and 99 Node application tests pass. Lint, typecheck, and the production
  build pass; the build includes `/` and `/api/packet-proposals`.
- The unchanged canonical territory was imported once from generation 3 / normalizer 4 to
  generation 4 / normalizer 5. It retained 10,663 usable assigned addresses. Boundary settings,
  exclusions, manual activations, exact-segment exclusions, and empty workflow tables were
  unchanged.
- Browser acceptance used one 30-tract packet and two 15-tract packets. All three proposals had
  connected highlights, written starting addresses, Google pins, estimates, and street summaries.
  Repeating the API request returned byte-identical JSON with 20 unique selected segments.
- Before and after repeated generation, `coverage_events`, `batches`, `packets`, and
  `packet_segments` each contained zero rows. Phase 4 generation made no reservation or workflow
  write.
- The founder-approved shared-map amendment is recorded in
  `docs/superpowers/specs/2026-07-28-shared-map-workspace-design.md`. `/` now owns one persistent
  Google map for Coverage, Generate Packets, and Territory Setup; `/packets` and `/territory`
  return 404. The complete heatmap remains beneath a selected electric-blue packet overlay.
- The supplied Streetlight logo and 44-pixel church marker are present. Packet proposals, unsaved
  territory changes, and the selected Map / Satellite basemap survive temporary tool switches.
- 99 Node checks and 26 Python importer checks pass. Lint, typecheck, and the production build pass;
  the production route list contains `/` and the three workflow APIs without separate packet or
  territory pages.
- Real-browser acceptance confirmed one map canvas across all three tools, Map/Satellite
  persistence, heatmap visibility in packet review, tight packet fitting, distinct church and
  starting markers, territory overlays, and retained packet and territory draft state.
- Follow-up browser acceptance generated ten proposals: all packet lines appeared together without
  starting pins, selecting a card focused one proposal and added its pin, and **Show all** restored
  the batch view. The sidebar scrolled through overflow and the legend stacked vertically.
- The pilot church coordinate was refreshed from the saved address's current Google geocode and the
  supplied pin artwork now anchors its pointed tip to that coordinate.
- A compact Google-style Layers card opens a local two-choice Map / Satellite chooser at the
  lower-right. It adds no thumbnail request, clears Google's attribution and compass, closes on
  selection, outside input, or Escape, and replaces the native horizontal map-type pills.
- Saved Overture import squares are now reused whenever they contain the proposed territory. A
  contained center shift, radius reduction, boundary-shape change, exclusion change, or segment
  edit avoids a refresh; expanding beyond the saved footprint still refreshes street data on save.
- The orphan-prevention amendment widens normal proposals to 70-130 percent, protects the oldest
  segment as each seed, permits connected newer-range fill only when needed, absorbs stranded
  branches, and cleans up small gaps bordered by generated packets. Packet connectivity now
  recognizes conservative T-junctions and aligned same-name gaps without joining nearby parallel
  roads.
- The amended selector passes 108 Node checks, Biome, TypeScript, and the production build. Two
  identical canonical 10-by-100 runs returned byte-identical results with ten unique proposals at
  117, 130, 111, 111, 108, 128, 123, 113, 119, and 130 estimated tracts and no warnings. Direct
  selection completed in about 1.6 seconds on the pilot territory.
- Browser evaluation regenerated those ten proposals on the shared map, showed coherent connected
  review highlights and the updated estimates, and reported no console warnings or errors.

### Human review

The founder checks grouping, tract counts, highlighted segments, outward progression from the
church, and proposed starting points.

### Completion condition

The founder approves packet proposals for the pilot territory and all deterministic selection checks pass.

## Phase 5: Batch finalization and PDF

### Goal

Turn approved proposals into reserved packets and printable output.

### Agent work

- Preview packet proposals without reserving their segments.
- Finalize the proposals as a batch in one transaction.
- Reserve every finalized packet segment.
- Reject finalization if another active packet already reserved a segment.
- Download the batch as one multi-page PDF with one packet per page.
- Include every packet field required by `PRODUCT.md`.
- Generate a Google Maps QR code for the printed starting address.
- Allow re-downloading the same finalized batch without changing its data.

### Automated checks

- Previewing creates no reservation.
- Finalization reserves every included segment once.
- Conflicting finalization fails without a partial batch.
- PDF page count equals packet count.
- Each page contains the correct packet identifier, starting address, home count, QR payload, and
  every selected segment on the map.
- Re-downloading does not create new packets or coverage events.

### Browser and print check

Preview a batch, finalize it, download it twice, compare packet identifiers, render every PDF page, and print a sample page.

### Evidence

- The isolated pilot-data review finalized one 28-tract packet in about 1.5 seconds, reserved its
  segments, automatically downloaded the PDF, and retained both download choices after reload.
- The Google Roads and Static Maps PDF request completed in about 1.3 seconds. The rendered PDF is
  one US Letter page with the stable packet code, 28-tract estimate, starting address, navigation
  QR, Google road labels, highlighted segments, starting pin, and Streetlight footer.
- The complete repository check passes: 119 Node tests, 26 Python importer tests, Biome,
  TypeScript, and the Next.js production build.

### Human review

The founder scans the QR code, checks the paper layout, reads the map, and confirms that the tract
count is easy to find.

### Completion condition

The founder approves a printed packet and reservations remain correct through preview, finalization, conflict, and repeat-download checks.

## Phase 6: Reconciliation and corrections

### Goal

Match the application to the church's physical table after packet distribution.

### Agent work

- Display every packet in a batch.
- Let the administrator select sheets still physically present.
- Preview all unselected sheets as completed.
- Require confirmation before recording coverage.
- Use the reconciliation date as the coverage date.
- Keep remaining sheets active or cancel them.
- Retain reservations for active sheets.
- Release reservations for cancelled sheets.
- Allow completion events to be corrected or undone with history retained.

### Automated checks

- Confirming creates one coverage event per completed packet segment.
- Repeating the same confirmation creates no duplicate events.
- Active remaining packets keep their reservations.
- Cancelled packets release their reservations.
- Corrections preserve the original event and change the visible last-covered result.
- Reconciliation never creates a partial-completion state.

### Browser check

Simulate a physical table with some sheets missing, preview the result, confirm it, keep one remaining sheet active, cancel another, and correct one mistaken completion.

### Human review

The founder performs the same simulation with printed sample sheets and confirms that the on-screen language matches the physical process.

### Completion condition

The founder completes the table simulation without database access, and all lifecycle and idempotency checks pass.

## Phase 7: Authentication and church isolation

### Goal

Protect the working application before deployment.

### Agent work

- Present the smallest suitable authentication option, including current cost and operational requirements, for founder approval.
- Add administrator sign-in without public signup.
- Map every administrator session to one church workspace.
- Enforce church ownership in server-side data access.
- Keep all administrators at one permission level.
- Add a second test church solely for isolation checks.

Do not trust a church identifier supplied by the browser without verifying it against the authenticated administrator.

### Automated checks

- Unauthenticated requests cannot access administrator pages or data.
- An administrator can access their church.
- An administrator cannot read, update, reconcile, or download another church's data.
- Direct requests with another church's identifiers are rejected.
- The application still builds and tests without live production credentials.

### Browser check

Sign in as administrators from two test churches and attempt the core workflow and cross-church URLs from both sessions.

### Human review

The founder approves the authentication provider and signs in through the real interface.

### Completion condition

Authentication works, isolation checks pass, and the founder approves the sign-in experience.

## Phase 8: Deployment and recovery

### Goal

Deploy the founder-church pilot and prove that its data can be recovered.

### Agent work

- Present the smallest hosting option that satisfies the product's cost constraint.
- Configure production environment variables without committing secrets.
- Deploy the authenticated application and database.
- Add automated database backups.
- Document and test the restore command.
- Add one production smoke check for application health.
- Run the core workflow in a real browser against the deployed application.

Do not add payments, public signup, analytics suites, or multi-region infrastructure.

### Automated checks

- Production build passes.
- Migrations apply to a fresh production-equivalent database.
- Health check passes.
- Backup completes.
- Restore creates a usable copy containing expected seeded records.
- The deployed core browser workflow passes.

### Human review

The founder signs in to the deployed application, creates a test batch, downloads its PDF, and confirms that a demonstrated restore contains the expected data.

### Completion condition

The production workflow and restore demonstration pass, and the founder approves the pilot URL.

## Phase 9: Founder-church pilot

### Goal

Use Streetlight for a real outreach batch and fix only problems that block the approved workflow.

### Agent work

- Import and correct the founder church's real territory.
- Generate and print a real batch.
- Support the administrator through distribution and reconciliation.
- Record discrepancies in geographic data, tract counts, segment grouping, map clarity, paper layout, and reconciliation.
- Fix workflow-blocking defects with regression checks.
- Record real hosting and provider costs.
- Revisit provisional pricing only after the pilot evidence is available.

### Automated checks

- Every pilot defect fixed in code has a check that would have caught it.
- The core browser workflow continues to pass.
- Backup and restore checks continue to pass.

### Human review

The founder runs the complete workflow without editing data manually or asking a developer to operate the application.

### Completion condition

The founder completes a real outreach batch from territory review through reconciliation and approves Streetlight for another church pilot.

## Standard agent handoff

At the end of a phase, the agent reports:

1. Phase status.
2. What changed.
3. Automated checks run and their results.
4. Browser checks run and their results.
5. Known limitations within the phase.
6. Exact human-review steps.
7. Any decision or credential needed.

The agent then stops. It must not begin the next phase until the founder approves the current phase.

## Reusable request

Use this form when assigning work:

> Work on Phase N in `IMPLEMENTATION_PLAN.md`. Follow `PRODUCT.md` and `AGENTS.md`. Verify dependency phases first. Implement only Phase N, run its automated and browser checks, update its status and evidence, then stop with the human-review checklist.

For Phase 0, include the test church address and radius in the request. Do not commit the address unless the founder confirms that it may be stored in the repository.
