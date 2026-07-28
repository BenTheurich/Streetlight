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
| 3 | Coverage history and heatmap | Phase 2 | Awaiting human review | Rebased onto current Phase 2 main and independently audited; 75 Node checks, 25 Python checks, lint, typecheck, production build, database invariants, and real-browser acceptance pass. Founder visual approval remains. |
| 4 | Packet selection | Phase 3 | Pending | None |
| 5 | Batch finalization and PDF | Phase 4 | Pending | None |
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

### Human review

If the current review server is no longer running, start it with
`pnpm --dir web coverage:demo` and open `http://localhost:3001`. Inspect every heatmap color,
change the selected period, select streets from the map and native control, manually change one
date, undo one completion, reload, and confirm that newest versus oldest areas are clear without
instructions.

### Completion condition

Coverage events, corrections, colors, and dashboard totals pass their checks and the founder approves the map.

## Phase 4: Packet selection

### Goal

Generate deterministic packet proposals from eligible street segments.

### Agent work

- Accept requested packet quantities and approximate home counts.
- Start with the oldest eligible segments.
- Prefer compact, connected segment groups.
- Exclude segments outside the territory boundary, touching or crossing exclusion areas, or
  reserved by active packets.
- Prevent a segment from appearing in two proposed packets in the same generation.
- Produce selected segments, a proposed starting address, a street list, and an estimated tract count.
- Choose the proposed starting address from an address assigned to one of the selected segments.
- Use a small deterministic heuristic focused on segment grouping. Do not build a route-optimization platform.

### Automated checks

Use one fixed synthetic street graph and one saved real-area fixture.

- Repeated runs produce the same packets.
- Older eligible segments are selected before newer comparable segments.
- Every selected segment is eligible.
- No segment appears twice.
- Packet home counts are calculated from their segments.
- Every packet segment appears in the proposal map.
- The proposed starting address belongs to the packet.

### Browser check

Generate mixed packet sizes, inspect each proposal on the map, regenerate the same request, and confirm the output does not change.

### Human review

The founder checks grouping, tract counts, highlighted segments, and the proposed starting point.

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
- Each page contains the correct packet identifier, starting address, street list, home count, and QR payload.
- Re-downloading does not create new packets or coverage events.

### Browser and print check

Preview a batch, finalize it, download it twice, compare packet identifiers, render every PDF page, and print a sample page.

### Human review

The founder scans the QR code, checks the paper layout, reads the map and street list, and confirms that the tract count is easy to find.

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
