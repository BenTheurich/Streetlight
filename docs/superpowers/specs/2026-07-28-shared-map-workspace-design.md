# Shared Map Workspace Design

**Date:** 2026-07-28  
**Status:** Awaiting final founder review  
**Authority:** `PRODUCT.md` remains authoritative

## Purpose

Streetlight should feel like one geographic workspace rather than a collection of map pages.
Coverage review, packet generation, and territory setup will share one persistent Google map at
the root route. Each tool changes the sidebar, segment styling, and active overlays without
replacing the map.

This amendment also introduces the supplied Streetlight logo and church-pin artwork and adds a
Map/Satellite basemap control.

## Founder decisions

- `/` is the only administrator workspace route.
- Coverage, Generate Packets, and Territory Setup are tools within that workspace.
- `/packets` and `/territory` will be removed, not retained as redirects.
- Switching tools must preserve the Google map instance, camera, and selected basemap.
- Coverage and packet tools show the complete coverage heatmap.
- Generated packets appear as high-visibility overlays above the heatmap until one is selected.
- Territory Setup uses the same map but changes segment styling to territory eligibility states.
- The supplied logo icon appears beside the existing `STREETLIGHT` text.
- The supplied church pin marks the saved church location in every tool.
- Packet review fits tightly to the packet. It does not zoom out merely to keep the church visible.
- The available basemap choices are Map and Satellite.

## Shared workspace

The root page renders one client-owned `StreetlightWorkspace` with three modes:

1. `coverage`
2. `packets`
3. `territory`

The header contains the brand at left and three tool buttons at right. Tool buttons update
in-memory mode state; they are not links to separate pages. Coverage is the default after a full
reload.

The workspace keeps each tool's transient state while the administrator switches modes:

- Coverage retains the selected segment, reporting period, and any in-progress date correction.
- Generate Packets retains request rows, generated proposals, and the selected proposal.
- Territory Setup retains the current saved workspace and any unsaved draft.

Errors remain inside the active sidebar and do not replace or reset the map.

## Branding

Implementation will copy the founder-supplied assets into the web application's public assets:

- `StreetlightLogo.png`
- `ChurchPin.png`

Both source files are 1024-by-1024 transparent PNGs and can be used without regenerating the
artwork.

The header brand uses a 32-by-32-pixel logo image beside the existing uppercase `STREETLIGHT`
text. The text remains the accessible brand name; the decorative icon uses empty alternative
text.

This amendment applies branding to the administrator website. It does not change the separately
approved printed-packet branding rules.

## Persistent map shell

One `AdminMap` component owns:

- the Google map instance;
- the camera and zoom;
- the selected Map/Satellite basemap;
- the church marker;
- current segment polylines; and
- tool-specific overlays and interactions.

Switching tools updates map data and interaction options without constructing a new Google map.
This also avoids unnecessary map loads and tile requests during ordinary navigation.

The custom lower-left **Layers** card opens a small Map/Satellite chooser in every mode. It uses a
local decorative thumbnail rather than another Google map or Static Maps request. The selected
basemap remains unchanged across tool switches because the map instance remains mounted.
Streetlight overlays do not change when the basemap changes.

If the browser map key is unavailable or Google Maps fails to load, the existing explicit
unavailable/error state replaces the map while the sidebar remains usable.

## Markers

The church marker uses the supplied `ChurchPin.png` artwork in a 44-by-44-pixel image box,
anchored at its bottom center. It is created once at the saved church coordinate and remains on
the map in every tool.

The church marker is always geographically present but is not guaranteed to remain inside the
current camera viewport. Selecting a packet fits the camera tightly to that packet, even when the
church is elsewhere.

Packet starting addresses continue to use Google's standard unlabeled red pin. The custom blue
church marker and red starting pin must remain visually distinct. Starting pins appear only when
a packet proposal is selected.

## Segment and overlay behavior

### Coverage

- Display every current segment.
- Eligible segments use the saved red, orange, yellow, and green heatmap classes.
- Ineligible segments use the existing gray treatment.
- Preserve the coverage legend and segment-history selection.

### Generate Packets

- Retain the complete coverage heatmap and legend.
- Before proposals exist, fit the map to the complete territory heatmap.
- Draw every generated proposal above the heatmap until the administrator selects one.
- Selecting a proposal draws and fits only that proposal; a **Show all** action returns to the batch
  view.
- Render packet proposals as thick electric-blue centerlines with a narrow white outer halo.
- Keep the heatmap visible beneath the selected-packet overlay.
- Show the standard red starting-address pin only for the selected proposal.
- Fit the camera tightly to the selected packet and its starting address, not to the church.
- Preserve proposal request rows and results when another tool is opened temporarily.

The packet highlight is an administrator review treatment. It does not change the Phase 5 printed
packet's approved one-stroke rule or final print palette.

### Territory Setup

- Keep the same Google map mounted.
- Replace heatmap styling with the existing included, excluded, and hidden-road treatments.
- Show the outer boundary, exclusion polygons, exact-segment selection, and hidden-road controls.
- Enable pan, polygon drawing, vertex editing, and segment-selection interactions only in this
  mode.
- Remove territory-only overlays and event handling when another tool is active.

Map and drawing controls must not overlap. Google's Map/Satellite control occupies the map's
upper-left control area; the territory Pan/Draw control sits immediately below it.

## Data flow

The root server page initially loads the coverage workspace and browser map key. It does not
serialize a second full territory dataset during the initial page load.

On first entry to Territory Setup, the client loads the current territory workspace through the
existing `GET /api/territory` endpoint. Later tool switches reuse the loaded territory state.

Coverage changes continue to use the coverage API response to update shared heatmap state.
Packet generation continues to call the read-only proposal API.

After a successful territory save:

1. replace the saved territory workspace with the PATCH response;
2. fetch a refreshed coverage workspace;
3. update the shared base segments and heatmap totals; and
4. clear packet proposals because their eligibility and geometry may now be stale.

The coverage API will expose a read-only GET response for this refresh. No additional provider or
state-management dependency is required.

## Route behavior

- `/` renders the shared workspace.
- `/packets` is deleted.
- `/territory` is deleted.
- The header contains tool buttons rather than route links.
- No compatibility redirects are retained.

## Accessibility

- Tool buttons expose pressed/current state.
- The logo text remains readable text rather than being embedded only in an image.
- The church marker has the title `Church`.
- The packet starting marker has the title `Starting address`.
- Existing form labels, live notices, legends, and keyboard-accessible territory controls remain.
- The Layers card and its Map/Satellite chooser are keyboard accessible.

## Error and stale-state rules

- A territory-load failure leaves the existing map and other tools available and shows a retryable
  sidebar error.
- Failed coverage, proposal, or territory mutations preserve the administrator's current form or
  draft.
- Switching tools does not discard unsaved territory edits.
- A successful territory save is the only territory action that invalidates existing packet
  proposals.
- Packet previews remain read-only and unreserved.

## Verification

Automated checks will prove:

- the root page exposes all three tools;
- the separate packet and territory pages no longer exist;
- one persistent map shell receives all tool modes;
- the supplied logo and church-pin assets are wired into the shared shell;
- Coverage and Generate Packets receive the same complete heatmap segment set;
- a selected packet adds a distinct overlay without replacing base heatmap lines;
- Territory Setup enables its own styling and interactions only while active;
- Map/Satellite configuration is present on the shared map;
- a territory refresh clears packet proposals and refreshes coverage; and
- existing packet determinism, territory editing, and coverage-history checks remain green.

Real-browser review will:

1. load `/` and confirm Coverage is the default;
2. switch through all three tools without a map reload or camera reset;
3. confirm the logo and church marker in every mode;
4. switch between Map and Satellite;
5. generate mixed packet sizes and inspect the selected overlay above the complete heatmap;
6. confirm packet fitting may place the church off-screen;
7. switch away from and back to packets without losing proposals;
8. enter Territory Setup and verify the eligibility, exclusion, and drawing overlays;
9. verify territory draft state survives a temporary tool switch; and
10. confirm `/packets` and `/territory` are absent.

## Out of scope

- Batch finalization, reservations, PDFs, and reconciliation
- Printed-packet branding or palette changes
- Additional basemaps beyond Map and Satellite
- Saving map camera or basemap choice across a full browser reload
- New map providers, state-management dependencies, or compatibility routes
- AI of any kind
