# Phase 9 workspace UX design

Status: awaiting concise founder review  
Date: 2026-07-30  
Mode: Operate  
Authority: `PRODUCT.md`

## Job and audience

Streetlight's authenticated workspace serves a church administrator preparing and recording
neighborhood tract outreach. The administrator may use it only around outreach days, so the
interface must make the current state and next likely action obvious without requiring them to
remember a process.

The normal cycle is:

1. review Coverage;
2. generate, review, finalize, and download a batch;
3. allow outreach to happen;
4. reconcile packets that were taken; and
5. return to Coverage for the next cycle.

The administrator may enter any available tool out of order. Streetlight guides the normal cycle
without enforcing it.

## Structural direction

Preserve the approved single-map workspace and header:

- `/` remains the only configured administrator workspace.
- Coverage, Generate Packets, Reconcile Packets, and Territory Setup remain always-visible tools
  after onboarding is complete.
- Coverage is the default after sign-in or a full reload.
- The approved one-row header keeps the Streetlight brand on the left, the four tool choices in
  the center, and the account control on the right.
- Remove duplicate current-tool text beside the wordmark or elsewhere in the header. The active
  tool is communicated once by the tool navigation and once as the right panel's task heading.
- The Google map remains mounted while tools change. Camera, basemap, selections, and in-progress
  tool state remain stable unless a completed mutation makes them stale.
- Each tool owns one consistent right-hand workflow panel. The map remains the primary work
  surface rather than being squeezed by another permanent navigation rail.

At supported desktop widths, the map and right workflow panel remain side by side. At portrait
tablet widths, the map occupies the upper working region and the workflow panel follows beneath it;
tool navigation and primary actions remain reachable without horizontal scrolling.

## Coverage home

Coverage is the administrator's recurring home, not a generic dashboard.

The right panel presents, in order:

1. the active tool name and concise purpose;
2. **Current work**, a factual state-based continuation;
3. the selected coverage period and essential territory totals; and
4. selected-street history or an instructional empty state.

Current work uses observable state rather than recommendation language:

- When finalized packets remain active, show the batch and active-packet count with a
  **Reconcile packets** action.
- When no packets remain active, state that coverage is ready for another batch with a
  **Generate packets** action.

This continuation is prominent but never replaces the persistent tool navigation or prevents
another action.

## Generate Packets

Generate Packets is one progressive workflow inside the right panel:

1. **Configure:** enter one or more packet quantities and tract targets.
2. **Review proposals:** inspect all proposed packets on the shared heatmap, select individual
   proposals, and return to the all-proposals view.
3. **Finalize:** optionally name the batch, finalize it, and download the newest finalized batch
   or every active batch.

Only controls for the current step are prominent. Earlier configuration remains editable until
finalization. Validation and deterministic shortfall explanations appear beside the request or
proposal they affect rather than at the bottom of a long panel.

Generated proposals survive tool switching for the current browser session. A successful territory
change invalidates them because eligibility or geometry may have changed.

## Reconcile Packets

Reconcile opens with the newest active batch selected and offers the existing all-active-batches
choice. Its panel prioritizes the packet list and each packet's current physical state.

The administrator can:

1. select an active batch;
2. review its packets on the shared map;
3. mark a whole packet as taken;
4. confirm the reconciliation date; and
5. correct or undo a completed packet through the existing whole-packet history rules.

Completion feedback stays in context. When the final active packet is reconciled, Current work
changes to the generate-next-batch state without forcing a navigation change.

## Territory Setup

Territory Setup has two distinct flows.

### Initial setup

After onboarding, Territory Setup is the only available task. The regular tool navigation is
omitted rather than showing three unusable destinations.

The administrator reviews the initial boundary and explicitly saves it. The first street import is
blocking because no other tool has usable data. Progress, current import stage, failure details, and
retry remain prominent inside the setup experience. The whole workspace is not dimmed behind a
small message.

On success, Streetlight unlocks the regular workspace and opens Coverage.

### Later maintenance

Later edits preserve the existing explicit-save model. Leaving with unsaved territory edits offers:

- **Save changes**
- **Discard changes**
- **Stay in Territory Setup**

An expansion beyond the saved import footprint runs in the background after save. The administrator
may use every other tool while the last completed territory remains active. Packet generation uses
that completed snapshot.

The expanded territory becomes active only after the complete import succeeds. Partial data is
never exposed. Failure leaves the previous territory untouched and produces a persistent,
actionable status with a return-to-setup action.

## Shared feedback and state

- Tool switching never silently loses generated proposals, map context, or form input.
- Territory drafts receive an explicit leave decision because they change eligibility.
- Background import status is visible from every tool without covering the map or stealing focus.
- Errors stay beside the action that failed and preserve user input.
- Empty states teach the next valid interaction.
- Loading states reserve the final layout and identify the task in progress.
- Primary actions use explicit verbs: **Generate proposals**, **Finalize batch**, **Download
  batch**, **Mark packet taken**, **Save territory**, and **Retry import**.
- Keyboard focus follows opened panels and confirmations, returns to the invoking control when
  they close, and never becomes trapped behind the map.

## Scope boundary

This document fixes workspace information architecture and task behavior only. It does not select
fonts, colors, decorative treatments, motion character, or final component styling. Those follow
after the workflow is approved.

Phase 9 also retains its separate work on onboarding presentation, pilot-request confirmation,
WorkOS branding, accessibility, and final visual consistency. Phase 10 owns the approved Outreach
Progress administrator, presentation, and print experience; it is not added to the Phase 9
workspace implementation.

## Validation

Browser review must complete these journeys without losing state or hiding a primary action:

1. sign in to Coverage, follow Current work into Generate Packets, finalize, and download;
2. switch tools with proposals present and return to the same proposal state;
3. reconcile the newest active batch and observe Current work update after the last packet;
4. attempt to leave an unsaved territory draft through all three choices;
5. complete a blocking first import;
6. start a later territory expansion, use another tool during import, and activate the new
   territory only after success;
7. repeat the complete workflow at representative desktop and portrait-tablet widths; and
8. use the primary path with keyboard controls and reduced motion enabled.
