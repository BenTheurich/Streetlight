# Founder account visibility review

Ben approved this extension on October 5, 2026. Implementation is local on
`codex/founder-church-accounts` and awaits human review. Ben separately authorized live deployment
on October 5, and the extension is deployed. The daily preview remains untouched; this work does
not start Phase 13.

## Account pages

The founder menu now includes Church accounts. Its overview lists every local church, including
churches created without a pilot request. Search covers church names, saved addresses, contacts,
and administrators. Filters select setup, ready, or current issues; sorting uses recent activity,
church name, or finalized packet count.

Selecting a church opens its saved territory map, boundary shape and distance, estimated homes,
street segments, and the latest import attempt. A failed replacement import displays its attempted
configuration separately from the territory still in use. Details also show current WorkOS
administrators and pending invitations, finalized batches and packets, active/completed/cancelled
packet counts, unique estimated homes reached, recent actions, and issue recovery history.

Pilot requests now reads the invitation's current WorkOS state on opening or manual refresh.
An accepted invitation displays Invitation accepted while the access request retains its approved
decision. Expired, revoked, pending, and unavailable states have separate labels. A link opens the
corresponding church account.

Both account routes and the read-only API require the existing founder session. Ordinary church
administrators cannot inspect other churches. Provider failures retain local territory and packet
records and explicitly mark membership and invitation status unavailable. Failed page refreshes
retain the previous snapshot.

## Recorded activity

Migration `031_account_activity.sql` adds church-scoped activity with trusted user identity,
operation, outcome, an optional opaque target, and a server timestamp. Meaningful authenticated
actions include onboarding, geocoding, territory saves, packet previews, finalization, PDF
preparation, reconciliation, packet and coverage corrections, heatmap ranges, printout settings,
and administrator changes. Polling and
map reads do not add activity. Recording failure never changes the original operation's result.

Issue recovery matches the operation and target where known. Success on one administrator or
packet target cannot recover a different target's failure. Import issues recover after a later
successful import. The timeline pages through older events using a church-scoped cursor.

Request bodies, raw provider errors, and secrets are not recorded. Historical actions cannot be
backfilled with an actor. Existing saved territory, imports, packet states, and outreach events
still supply current totals. Prepared PDFs do not prove printing; unreported browser problems and
user confusion do not appear as recorded issues. Unique estimated homes reached applies effective
corrections and undo within the current saved territory.

## Verification

The final canonical `pnpm check` passed against a clean isolated copy of the application source in
`tmp/founder-account-polish-check`. Its log is
`tmp/founder-account-polish-check/verification.log`. This copy contains no browser-only fixtures.
All database checks used disposable files, and WorkOS checks used fake adapters.

| Check | Result |
|---|---|
| Application tests | 453 passed |
| Python launcher tests | 4 passed |
| Importer tests | 73 passed |
| Lint | 228 files, no findings |
| TypeScript | Passed |
| Production build | Passed, including Church accounts and its API |
| Authorization | Founder-only access; ordinary and signed-out sessions denied before data/provider reads |
| Invitation state | Accepted, pending, expired, revoked, unavailable; approved request decision preserved |
| Data correctness | Churches without requests, failed replacement imports, target-specific recovery, actor attribution, corrections/undo, unique homes, scoped pagination |
| Browser | Search, setup/issues filters, sorting, details, map, older activity, refresh failure, provider failure, invitation accepted after refresh, founder navigation |
| Responsive and keyboard | Desktop, 768px tablet, 390px and 320px phones; no horizontal overflow; Enter expands and collapses details; visible map-control focus |
| Impeccable detector | No findings |
| Independent finish review | Initial review missed oversized preview roads; fresh visual correction review says `ship`, with no material findings |

Browser verification used a separate server on port 4207 with synthetic churches and fake WorkOS
responses. The copied review source bypassed authentication only for those fixtures; the canonical
application keeps its founder guards. No live invitation, membership, or account was read or
changed. The review harness initially copied its pilot refresh wrapper instead of the original
handler; correcting that fixture made the pending-to-accepted refresh pass without an application
change.

Screenshots are in the ignored `output/playwright/founder-accounts/` directory. The corrected
captures include `polish-desktop-map.jpg`, `polish-desktop-history.jpg`, `polish-mobile-map.jpg`,
`polish-320-long-history.jpg`, `polish-tablet-long.jpg`, `polish-empty-search.jpg`,
`polish-not-configured.jpg`, `polish-mobile-refresh-error.jpg`, `polish-mobile-provider-error.jpg`,
`polish-pilot-provider.jpg`, and `polish-pilot-expired.jpg`. They supersede the original map
screenshots. The route brief is
`web/.impeccable/surfaces/app-church-accounts-page-tsx.md`.

The corrected interface keeps the existing typography and materials, desktop reading order,
mobile reflow, saved/attempted territory distinction, packet meaning, and explicit invitation
states. The existing `DESIGN.md` and its sidecar remain unchanged.

| Finish-review element | Verdict |
|---|---|
| Typography and material | Match |
| First viewport and desktop layout | Match |
| Mobile layout | Adaptation required by the responsive brief |
| Saved versus attempted territory | Match |
| Packet meaning and invitation state | Match |
| Recovery, activity, and labeled synthetic data | Match |
| Material fixes | Shared road widths, 44px map controls, issue-label alignment, invitation-state colors and refresh spacing |

## Visual correction review

Ben identified oversized roads in the original account screenshot. The preview used the raw map
style and bypassed the approved road-width and label adjustments used by the workspace. It now
uses `buildBaseMapStyle`, shared with workspace and packet maps. A regression check verifies the
actual base style, matching road layers, unchanged input, and absence of workspace-only data.

The pass also corrected undersized zoom and attribution controls to 44 by 44 pixels, aligned
issue labels with their messages, and changed a one-mile territory's label to `1 mile`.
Pilot requests now uses warning colors for pending or unavailable invitations and error colors
for expired or revoked invitations. The refresh controls have a 24px gap before the next heading.

Browser checks covered long church names, addresses, administrator names and emails, empty
search results, accounts without a saved territory, retained snapshots after refresh failures,
and unavailable provider data. Desktop, tablet, and narrow phone views retained readable text
without horizontal overflow. The final phone capture verifies 44px zoom and attribution controls
with visible attribution credits. The full check passed 525 tests, lint, types, and build after
these visual changes. The PR review follow-up adds one approval-recovery regression, bringing
the full check to 526 tests. Coverage activity review adds one regression, bringing the final
full check to 527 tests. The additional reconciliation recovery regression brings the final
full check to 528 tests.

The independent read-only review also checked the corrected map, long content, tablet layout,
empty and error states, and Pilot requests colors and spacing. Its final disposition is `ship`,
with no material visual findings. The final enlarged phone controls were verified separately in
the browser.

## PR review follow-up

Codex code review identified a resumed-approval case where WorkOS could reuse an accepted,
expired, or revoked invitation while the UI assumed it was pending. Approval now returns the
current provider state and uses it for both the row and feedback. A failed provider lookup keeps
the approved decision and displays unavailable status. The regression covers all five invitation
outcomes with an existing organization and reused invitation.

A later code review identified untracked heatmap-range saves and non-packet coverage corrections.
Both mutations now record trusted actor, church, outcome, and the correction event target where
known. Validation rejections remain separate from storage failures, and GET remains untracked.
The regression verifies successful and rejected writes, injected storage failures, unchanged
HTTP responses, and absence of request values or storage-error text in the log. The undeployed
migration 031 includes both action names.

Ben authorized one additional repair and review cycle after the two-cycle limit. Reconciliation
and packet correction now preserve their batch or packet target in storage-failure responses.
The regression injects a storage failure for target A, succeeds on target B, and verifies that
A's issue remains unresolved until A succeeds. It covers both mutations through authenticated
handlers and the founder account read, preserving actor attribution and safe error responses.
The full isolated `pnpm check` passes 528 tests, lint, types, and build. Its Playwright browser
cache is isolated inside the verification folder.

Ben authorized another focused repair/review cycle and live deployment for two later findings.
Finalization now records the validated proposal fingerprint on successful, rejected, and failed
attempts. PDF preparation retains the validated batch or scope before packet selection, including
selection failures. Both regressions failed on the old handlers and pass with these fixes. They
verify that success on B leaves A's failure unresolved, then a successful retry of A resolves it
through the founder account read. PDF checks cover batch, newest, and active scopes without
changing packet or coverage records. Actor/church attribution and safe error responses remain
covered. The full isolated `pnpm check` passes 530 tests, lint, TypeScript, and build.

## Human review

1. Open Church accounts from the founder menu and search for a church.
2. Expand it; compare the saved map and radius with its latest import attempt.
3. Check finalized, active, completed, cancelled, and resolved packet totals and estimated homes reached.
4. Inspect administrators, pending invitations, current/recovered issues, and older activity.
5. Open Pilot requests, refresh invitation statuses, and follow a church account link.

Ben authorized deployment through the existing runbook. The first rollout applied migration 031
on October 5 and passed health, integrity, foreign-key, data-preservation, and founder access checks.
Activity recording began with that deployment. Follow-up repairs use the same deployment runbook
and need no new migrations, environment variables, or providers.
