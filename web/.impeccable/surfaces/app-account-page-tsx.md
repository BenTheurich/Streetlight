---
version: 1
slug: "app-account-page-tsx"
primary_target: "app/account/page.tsx"
related_targets: ["components/ChurchAccount.tsx","components/AdministratorPage.tsx","components/AdministratorAccount.tsx","app/administrator-page.css","app/account/account.css"]
---

# Church account

## Scope

Mode: Operate.

The `/account` page lets a signed-in church administrator read church access, invite another full administrator, remove a named administrator, or revoke a pending invitation before returning to the workspace. Keep this route focused on those tasks, without marketing, general settings, or billing controls.

## Layout and interaction

Use AdministratorPage for the lamp header, unchanged workspace menu, Back to workspace link, title, and church name. Keep the header pinned to the top while the page scrolls. The shared content width is capped at 62rem. Access is a compact strip with a 120px label column. Administrators has one panel containing the invitation form and roster, with initials beside members and an envelope beside pending invitations. At 600px and below, access content stacks; at 450px and below, the invite button stacks below its email field.

Show the current access label and applicable no-payment wording. Ben's account review removes the standard-price line. The administrator list keeps names or email addresses beside their actions, identifies the current user as You, and labels pending invitations. Removal confirmation stays inside the selected row and names the person losing access. Place mutation feedback near the invite form, preserve the roster during errors, and offer Retry when roster loading fails.

## Fit with the existing design

The route inherits the cream paper, navy Trebuchet interface type, lamp asset, rounded controls, and blue keyboard focus from the existing application. The administrator panel uses the existing panel background and line token. Roster separators group each person with their action. No new system tokens were introduced. Keep menu geometry in the shared workspace styles; account-specific link padding caused the menu mismatch reported by Ben.

Durable fit check: the built route preserves the palette and operational typography defined in root DESIGN.md, uses the existing control geometry, and keeps route-specific widths and breakpoints in account.css. The account page is a temporary destination with an explicit return to the map workspace. Root DESIGN.md and its sidecar remain authoritative.

Verification: rendered-contracts.test.mjs compares menu and row geometry across the workspace, account, and access request pages using their actual styles. Isolated browser checks cover 1440px, 768px, and 390px widths, removal confirmation and focus restoration, and unavailable-roster recovery. Local captures are in output/playwright/account-access/. Preview data and API adapters are disposable; these checks do not call live WorkOS.

## Deferred decision

The support email remains the existing placeholder by Ben's decision. It is not a verified support destination. This brief adds no new visual decisions to the global design system.
