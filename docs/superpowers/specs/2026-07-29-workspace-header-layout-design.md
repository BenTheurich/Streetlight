# Workspace header layout

Status: approved design

## Purpose

Make the administrator workspace header feel calm and usable without reducing map space.

## Approved design

- Keep one 68-pixel header row.
- Place the Streetlight logo and wordmark on the left.
- Center the four administrator tools in a quiet, single-row navigation.
- Replace the exposed email and sign-out link with one account pill on the right.
- Show administrator initials, the email address, and a chevron in the account pill.
- Clicking the pill opens a small right-aligned menu containing the full email address and
  **Sign out**.
- At narrower widths, hide the email text before reducing access to either the tool navigation or
  account control. Keep the avatar visible.
- Preserve the existing Streetlight colors, type, tool names, and map workspace behavior.

## Interaction and accessibility

- The account pill is a button with an expanded state.
- The menu closes when the administrator clicks outside it, presses Escape, signs out, or reopens
  the account pill.
- Tool and menu actions remain keyboard accessible with visible focus.
- The account menu does not change authentication behavior or session handling.

## Verification

- The header remains one row at the current desktop review width.
- Long email addresses truncate without moving or wrapping the tools.
- The account menu opens beside its button and exposes the full email and sign-out action.
- Existing administrator-account and workspace tests continue to pass.
