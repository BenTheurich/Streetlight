# Phase 6 reconciliation and corrections design

Status: founder approved
Approved: July 29, 2026
Product authority: [`PRODUCT.md`](../../../PRODUCT.md)
Phase authority: [`IMPLEMENTATION_PLAN.md`](../../../IMPLEMENTATION_PLAN.md)

## Goal

Match Streetlight to the church's physical packet table after distribution while preserving
reservations, coverage history, and the indivisible packet model.

Phase 6 ends when the founder can reconcile a sample table, correct a mistaken date, and undo a
mistaken completion without database access.

## Founder decisions

- Reconciliation handles one batch at a time.
- The newest batch with active packets is selected by default; older active or completed batches
  remain available from a batch selector.
- Every active packet starts unchecked. The administrator checks the sheets still physically
  present and may use **Select all present** or **Clear selection**.
- An unchecked sheet means **Missing — complete**.
- A checked sheet defaults to **Keep active** and may instead be set to **Cancel and release**.
- There is no delete action and no bulk-cancel action.
- The administrator reviews a complete preview before one atomic confirmation.
- The coverage date is the current date in the church's time zone on the day of reconciliation.
- Corrections and undo apply to the complete packet, never to part of one.
- Street and apartment packets are both atomic.

## Scope

Phase 6 includes:

- a fourth **Reconcile packets** tool in the shared map workspace at `/`;
- batch selection and packet inventory;
- reconciliation preview and confirmation;
- completion, continued activation, and cancellation;
- reservation retention and release;
- append-only whole-packet date correction and undo;
- apartment coverage dates and heatmap state; and
- apartment proposals participating in requested packet slots.

Phase 6 does not include:

- partial packet completion;
- deleting packets or history;
- volunteer reporting;
- editing packet membership;
- manually editing imported geometry or tract estimates;
- drawing apartment units or access instructions; or
- AI or image extraction.

## Administrator workflow

The Reconcile packets sidebar opens the newest batch containing active packets. Its batch selector
also exposes older batches with active, completed, or cancelled packets. The selected batch summary
shows its name, finalization date, and packet-state counts.

The active-packet list shows, for every packet:

- a **Still on table** checkbox;
- packet code;
- estimated tracts;
- starting address;
- packet type: Street or Apartment; and
- **Keep active** or **Cancel and release** when checked.

Completed and cancelled packets remain visible below the active list as read-only history. Selecting
one exposes its correction actions.

**Review reconciliation** opens a confirmation grouped into:

- **Complete missing**;
- **Keep active**; and
- **Cancel**.

The confirmation displays the church-local reconciliation date. **Back** changes nothing.
**Confirm reconciliation** applies the complete update atomically.

After confirmation, Streetlight refreshes the heatmap, active-packet count, batch summary, and
history. The batch remains finalized while it contains active packets. With no active packets it
becomes reconciled, except that a batch in which every packet was cancelled becomes cancelled.

## Map behavior

The shared map retains the normal heatmap beneath reconciliation overlays:

- unchecked packets that will be completed are green;
- checked packets that will remain active are blue; and
- checked packets marked for cancellation are gray.

All active packets in the selected batch are shown. Selecting a row tightly focuses that packet;
only a single selected packet shows its starting pin. Completed and cancelled packets are not
overlaid unless the administrator selects one from history.

Apartment packets use their complex location rather than artificial street geometry.

## Confirmation contract

The browser submits the selected batch, the exact active packet IDs shown during review, the packet
IDs still present, and the subset to cancel. It does not submit a trusted coverage date.

Before writing, the server verifies that the selected batch and active-packet set are unchanged.
A stale review returns a conflict and writes nothing.

Inside one transaction, Streetlight:

1. marks every missing packet completed;
2. creates one packet-linked coverage root for every street segment in a completed street packet;
3. creates one packet-linked coverage root for a completed apartment packet;
4. leaves present packets active with their reservations intact;
5. marks cancelled packets cancelled and releases their reservations; and
6. recomputes the batch status.

Repeating an already-applied request creates no duplicate events or state changes.

## Coverage history and corrections

A coverage event targets exactly one street segment or one apartment complex. Packet-generated
events also reference their packet. Existing historical events remain valid without a packet
reference.

Packet-generated coverage is managed as a whole packet:

- changing its date appends corrections for every target in one transaction;
- the original events remain in history;
- undo appends the corresponding history changes and restores the packet to active;
- undo reveals any earlier coverage date that preceded the mistaken completion; and
- the Coverage detail identifies packet-managed history and directs corrections to Reconcile
  packets instead of offering a per-segment edit.

Undo restores every reservation or restores none. If any segment or apartment is now reserved by a
newer active packet, Streetlight rejects the undo and identifies the conflict. The administrator
must resolve the newer packet before retrying.

## Apartment lifecycle

Reconciliation gives a completed apartment complex a last-outreach date and the same configurable
heatmap age treatment as street coverage. Completion does not silently change the complex's review
state.

Ready, unreserved apartments participate in the requested proposal count rather than being appended
after all requested street packets:

- selection remains heatmap-range-first;
- recently covered apartments do not displace older street or apartment candidates;
- estimated tract count is used to match a requested packet size;
- the existing packet-size tolerance applies where possible;
- an indivisible apartment outside that tolerance remains atomic and is clearly flagged rather
  than split or silently orphaned; and
- proposal generation never exceeds the requested packet quantity.

## Error and empty states

- No active batches shows a clear empty state and leaves completed batch history available.
- A stale review, changed reservation, or repeated state transition writes nothing partial.
- Invalid packet sets or cancellation choices return a validation error.
- A failed transaction leaves packet states, reservations, and coverage unchanged.
- A conflicting undo explains which newer active packet must be resolved first.
- The routine reconciliation date is not editable; an administrator uses the explicit correction
  action after reconciliation when necessary.

## Verification

Automated checks must prove:

- previewing reconciliation writes nothing;
- one confirmation completes every missing packet target exactly once;
- a repeated or stale confirmation creates no duplicate or partial history;
- present packets remain active and reserved;
- cancelled packets remain in history and release reservations;
- batch status follows its packet states;
- date correction updates every packet target atomically while retaining the original events;
- undo restores earlier visible coverage and all reservations, or rejects the complete undo on one
  conflict;
- street-segment Coverage detail cannot partially correct packet-managed history;
- an apartment completion updates its heatmap age;
- recently completed apartments do not immediately displace older candidates;
- apartment proposals count toward, and never exceed, the requested packet quantity; and
- the production build, TypeScript, Biome, Node tests, importer tests, and `git diff --check` pass.

The browser check simulates a physical table with missing, remaining, and cancelled sheets; confirms
the preview; corrects one completed packet date; and undoes one mistaken completion. It includes an
apartment packet. The human checkpoint repeats the workflow with printed sample sheets and confirms
that the language matches the church's physical process.
