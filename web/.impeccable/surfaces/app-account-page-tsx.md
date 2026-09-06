---
version: 1
slug: "app-account-page-tsx"
primary_target: "app/account/page.tsx"
related_targets: ["components/ChurchAccount.tsx","components/AdministratorAccount.tsx","app/account/account.css"]
---

# Church account

## Scope

Mode: Operate.

The `/account` page lets a signed-in church administrator read church access, invite another full administrator, remove a named administrator, or revoke a pending invitation before returning to the workspace. Keep this route focused on those tasks, without marketing, general settings, or billing controls.

## Layout and interaction

Retain the existing lamp header and administrator menu. Lead with Back to workspace, Church account, and the church name. Access and Administrators follow as two sections separated by thin rules. The desktop content has a 56rem maximum width and a 160px label column. At 700px and below, labels stack above section content; at 450px and below, the invite button stacks below its email field.

Show the current access label and applicable no-payment wording. Ben's account review removes the standard-price line. The administrator list keeps names or email addresses beside their actions, identifies the current user as You, and labels pending invitations. Removal confirmation stays inside the selected row and names the person losing access. Place mutation feedback near the invite form, preserve the roster during errors, and offer Retry when roster loading fails.

## Fit with the existing design

The route inherits the cream paper, navy Trebuchet interface type, lamp asset, rounded controls, and blue keyboard focus from the existing application. Section rules and roster separators keep the page flat. The email field uses the existing muted color for its border. No new system tokens were introduced.

Durable fit check: the built route preserves the palette and operational typography defined in root DESIGN.md, uses the existing control geometry, and keeps route-specific widths and breakpoints in account.css. The account page is a temporary destination with an explicit return to the map workspace. Root DESIGN.md and its sidecar remain authoritative.

Evidence: web/app/account/page.tsx, web/components/ChurchAccount.tsx, web/components/AdministratorAccount.tsx, web/app/account/account.css, and web/app/globals.css. Desktop and phone captures are output/playwright/phase11-account/founding-1440.png and founding-390.png. The finish review disposition was ship, with no material fixes.

## Deferred decision

The support email remains the existing placeholder by Ben's decision. It is not a verified support destination. This brief adds no new visual decisions to the global design system.
