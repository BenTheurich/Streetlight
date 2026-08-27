# Phase 9 founder UX polish design

Status: founder-approved; implementation pending
Approved: 2026-08-01
Mode: Operate
Authority: `PRODUCT.md`
Supersedes: conflicting Phase 9 details in `2026-07-30-phase9-workspace-ux-design.md`

## Job and audience

Streetlight's authenticated workspace serves a church administrator who may prepare outreach only
occasionally. The interface must make the current state, the next likely action, and the map's
meaning obvious without asking the administrator to remember internal identifiers or wait through
ambiguous loading states.

Phase 9 remains a refinement of the approved workflow. It does not add Outreach Progress, church
settings, packet-footer customization, or any other Phase 10 behavior.

## Outcome

The founder can approve the authenticated workspace for pilot use with:

- a searchable, human-readable street-segment inspection flow;
- a stable Coverage home with an always-reachable factual continuation;
- clear, branded, accessible status treatment for real operations;
- legible apartment markers that cluster truthfully at overview zooms;
- coherent workspace tokens and interaction states; and
- no regression to the landing page, coverage legend, estimated-progress bar, basemap, packet
  cartography, or deterministic workflow.

## Selected direction

The administrator workspace remains calm, paper-toned, map-first, and operational. Streetlight's
brand appears through the lamp mark, navy and cream surfaces, Georgia/Trebuchet typography, precise
spacing, and restrained amber. Coverage colors remain factual and are not borrowed for decoration.

Phase 9 keeps the four currently implemented primary tools: Coverage, Generate Packets, Reconcile
Packets, and Territory Setup. The founder-approved future four-tool composition—Coverage, Packets,
Outreach Progress, and Setup—is a Phase 10 change and must be made atomically with those Phase 10
surfaces after the Phase 9 human-review checkpoint.

## Protected surfaces and anti-goals

The following remain substantially unchanged:

- the approved public landing-page composition, imagery, pilot drawer, and motion;
- the Coverage heatmap legend and its range editor;
- the Current estimated progress bar;
- MapLibre/OpenFreeMap basemap styling and Map/Satellite camera synchronization;
- packet proposal overlays and printable packet cartography; and
- WorkOS, onboarding, packet generation, finalization, reconciliation, and territory behavior
  already required by `PRODUCT.md`.

Phase 9 does not add a notification center, unread state, activity-history schema, global loading
store, fake progress percentage, settings framework, custom mapping library, or new dependency for
search, icons, or clustering.

## Design-system contract

`DESIGN.md` is the visual authority. `.impeccable/design.json` is a generated sidecar and must not
be propagated as a universal component contract while it is stale.

Implementation must:

- preserve separate public and operational control variants;
- add only shared operational tokens that the completed interface actually uses: selected blue,
  focus ring, quiet hover surface, warning/error surfaces, and floating/recovery elevation;
- use the canonical Packet Blue for selection and focus when it meets contrast requirements;
- keep every target at least 44 pixels tall or wide where applicable;
- provide explicit default, hover, focus, disabled, busy, error, success, selected, and recovery
  states where those states exist;
- keep factual coverage colors out of decorative Current Work styling;
- reserve shadows for real layers or blocking/recovery states; and
- make motion optional, brief, and nonessential under `prefers-reduced-motion`.

The tool switcher's inactive hover treatment must not paint an opaque surface over the moving navy
selection indicator. Hover may change text, border, or inset emphasis while the indicator remains
visually continuous. Reduced motion removes the slide without weakening the active state.

## Street-segment search and inspection

Coverage begins with no arbitrary segment selected. The whole territory remains framed until the
administrator chooses a segment from the map or search results.

The existing select menu becomes a labeled native search field followed by ordinary result
buttons. This avoids a custom ARIA combobox while preserving keyboard and screen-reader operation.

Search behavior:

- match street names case-insensitively after trimming whitespace;
- show no internal segment ID or hash;
- show at most 20 results, ordered by street name and then stable source order;
- when more results match, ask the administrator to refine the search;
- provide explicit initial, result-count, and no-result states; and
- keep unnamed roads reachable with the label `Unnamed road`.

Each result shows the street name, estimated tracts, last outreach or `Never`, and
eligible/excluded state. Duplicate street names are distinguished by this human context and by the
map focus, not by an implementation identifier.

Selecting a search result:

- updates the shared selected-segment state;
- collapses the result list into the selected detail;
- gives the segment an unmistakable Packet Blue selection treatment that does not overwrite its
  underlying coverage meaning;
- fits its complete geometry with sidebar-aware padding and a maximum neighborhood zoom; and
- uses immediate camera movement when reduced motion is requested.

Clicking a segment on the map updates the same selected detail and search label but does not
recenter a map the administrator is already navigating.

The selected detail shows street name, estimated tracts, named coverage range, last outreach,
eligibility or exclusion reason, and existing completion/correction history. Existing audit event
identifiers may remain in the correction history; the founder request removes hashes from the
picker, not from the underlying audit trail.

## Current Work

Current Work remains part of Coverage because Coverage is the recurring operational home. It is
docked to the bottom of the Coverage sidebar outside the scrolling detail region so the next
factual continuation remains reachable without displacing the map or progress summary.

When active packets exist, it shows the active count, newest finalized batch when available, and a
Reconcile Packets action. Otherwise it states that Coverage is ready for another batch and offers
Generate Packets.

Current Work is not replaced by a notification bell. Streetlight has no durable unread model, and
normal work awaiting action is not a notification. A future header badge may show a factual active
packet count only if later evidence shows the docked continuation is insufficient.

## Operation status and recovery

One small presentational operation-status pattern expresses existing local operation states. It
does not own application state.

It has two placements:

- **Surface status:** flat, layout-reserving, and adjacent to the initiating workflow. Use it for
  initial territory import, proposal generation, and PDF preparation/download.
- **Global status:** a floating persistent layer for a later background territory expansion that
  remains relevant while another tool is open.

Every active status includes a non-color visual cue, task-specific headline and detail,
`role="status"`, polite atomic announcement, and a static reduced-motion fallback. Failure replaces
the busy status with a nearby `role="alert"`, explains what remains safe, and provides the existing
explicit recovery action. No status dims the whole workspace, steals focus, or clears safe work.

The bottom-left `N` seen under `next dev` is the Next.js development indicator. It is absent from a
production build and receives no product CSS or replacement. Streetlight's operation status is
driven only by real import, proposal, and PDF state; it is never coupled to framework compilation
or map-loading state.

## Apartment markers and clustering

Apartment complexes use native MapLibre GeoJSON clustering at territory overview zooms. Clusters:

- use a neutral navy/slate treatment because their members may mix review and coverage states;
- display an abbreviated complex count;
- expand toward their constituent complexes when selected; and
- disappear by neighborhood zoom so individual complex markers return.

Individual markers retain their existing factual state colors. The exact individual glyph is
chosen in one bounded visual comparison among a refined `A`, a simple building glyph, and a
footprint-style mark. The chosen glyph must remain legible on Map and Satellite, survive style
reloads, require no new dependency, and not obscure state color. If the icon lifecycle makes the
building variants unreliable, the refined `A` is the deterministic fallback.

Cluster and marker interaction must not trigger territory polygon drawing or exclusion editing.
Exact-coordinate duplicates may remain visually coincident at maximum zoom; Territory Setup
provides the deterministic accessible fallback instead of adding spiderification.

Territory Setup adds a labeled native apartment selector using address or `Address unavailable`,
review state, and estimated tracts. Map clicks update the selector and existing detail card;
keyboard selection updates the same detail and centers the complex without reducing an already
closer zoom.

## Responsive and accessibility requirements

At desktop width, the persistent map and right workflow sidebar remain side by side. At portrait
tablet width, the complete tool navigation remains visible, the map appears above the workflow
panel, and no control requires horizontal scrolling. Phone behavior may retain the existing compact
labels, but Phase 9 acceptance is desktop and tablet.

The completed flow must provide:

- visible focus with sufficient contrast on Church Paper and Bright Paper;
- keyboard operation for tool navigation, segment search/results, apartment selection, dialogs,
  and recovery actions;
- programmatically announced selection, loading, success, and error states;
- no meaning communicated by color alone;
- safe focus movement and return around dialogs and tool changes; and
- reduced-motion behavior that does not depend on animation to reveal state.

## Implementation boundaries

The work is divided so shared files have one active owner at a time:

1. operational tokens, focus/state styles, operation-status presentation, and tool-hover repair;
2. existing async-state wiring for import, proposal, PDF, and reconciliation flows;
3. Coverage segment search, selected detail, map focus, and docked Current Work;
4. apartment clustering, glyph selection, accessible selector, and map interaction guards; and
5. integration review, automated checks, bounded browser verification, and evidence update.

No Phase 10 code begins before the founder approves the complete Phase 9 human-review checklist.

## Validation

Automated checks must cover:

- segment filtering, result limits, stable ordering, and no exposed segment IDs;
- initial unselected state and source-aware camera focus;
- operation-status semantics and preservation of existing packet download counts;
- clustered source configuration, neutral cluster layers, individual-layer filters, and Map/
  Satellite visibility parity;
- apartment selector state and drawing-interaction guards;
- active tool semantics, visible focus, and reduced-motion rules; and
- all existing workflow, isolation, importer, map, PDF, and reconciliation behavior.

After targeted checks, run the complete Node and Python suites, Biome, TypeScript, the credential-
safe production build, and repository diff checks.

Browser verification uses one bounded desktop/tablet pass, one combined correction batch, and at
most one confirmation pass. It covers:

1. tool-switcher hover during and after the active-indicator transition;
2. keyboard segment search, no-results behavior, result selection, map focus, and direct map click;
3. docked Current Work in both active-packet and ready-for-batch states;
4. initial import, background import, proposal generation, PDF preparation, failure, and recovery;
5. apartment clusters, expansion, high-zoom markers, map selection, keyboard selection, and drawing
   isolation;
6. Map and Satellite at representative desktop and portrait-tablet widths;
7. reduced motion and keyboard-only operation;
8. unchanged landing composition, legend, Current estimated progress bar, and packet cartography;
   and
9. absence of the Next.js development indicator under the production server.

## Human-review checkpoint

The founder reviews Coverage, Generate Packets, Reconcile Packets, and Territory Setup at desktop
and portrait-tablet widths, including the representative loading and recovery states above. Phase 9
is complete only when the founder approves the authenticated interface for pilot use and the
existing workflow remains unchanged.
