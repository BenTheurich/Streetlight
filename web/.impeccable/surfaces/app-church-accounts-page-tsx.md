---
version: 1
slug: "app-church-accounts-page-tsx"
primary_target: "app/church-accounts/page.tsx"
related_targets: ["components/FounderChurchAccounts.tsx","components/FounderTerritoryMap.tsx","app/church-accounts/accounts.css"]
---

# Founder church accounts

Mode: Operate. The founder scans church setup, outreach usage, administrators, and recorded support
needs through a read-only account overview.

The page inherits AdministratorPage, cream and navy account styling, Trebuchet interface type, and
thin warm rules. The first viewport puts the heading and snapshot freshness above search, sort,
counted filters, and operational rows. Root DESIGN.md and its sidecar remain the visual authorities;
this extension establishes no global tokens or rules.

The desktop table has four columns: church and setup, territory, packets, and latest activity with
issues. Search covers church names, addresses, contacts, invitations, and administrators. Filters
select all churches, setting up, ready, or current issues; sorting uses activity, name, or finalized
packets. At 760px and below, rows stack with visible field labels. The church-name button expands
and collapses details inline with keyboard support and an explicit expanded state.

Expanded details pair saved territory with current outreach totals and the administrator roster,
then show issue recovery and activity. The MapLibre map uses buildBaseMapStyle with the approved
workspace road widths and labels, shared boundary style, and church pin. Zoom and attribution
controls are 44px square and preserve visible attribution credits. Details become one column on
phones. Saved territory remains distinct from the latest
import attempt. Activity loads in 50-row cursor pages, preserving recorded outcomes and unattributed
historical actors.

Refresh failures retain the previous snapshot. Provider failures mark membership and invitation
status unavailable while keeping local territory and packet records visible. Text identifies
current issues, recovered issues, and failed outcomes; restrained warning and error colors support
those labels.

Synthetic browser checks passed desktop, 768px tablet, 390px and 320px phone layouts without
overflow, including long church names, addresses, and administrator emails. Checks covered search, setup and issue
filters, sorting, Enter expansion and collapse, map loading, saved and failed import attempts,
50-to-59 activity pagination, refresh and provider failures, invitation acceptance on refresh, and
founder navigation. Screenshots are in ignored output/playwright/founder-accounts. The finish
review initially missed oversized roads; the visual correction pass fixed the raw-style bypass,
undersized map controls, issue-label alignment, and singular mile labels. A fresh independent
review says ship with no material visual findings. Detector findings: [].
The root implementation review owns the full verification record.
