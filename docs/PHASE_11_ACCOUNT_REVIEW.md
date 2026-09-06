# Phase 11 account review

September 6, 2026. Status: complete.

Ben approved the current public website and requested Church account and administrator management
in the existing visual style, with minimal copy. Phase 10 is complete. This change finishes the
remaining Phase 11 implementation. Ben subsequently approved the Account presentation subject to
the functionality working. The real staging checks below passed, satisfying that approval. Work
stops before deployment.

## Implementation

The administrator menu now opens `/account`. The page shows the church name, its access label,
one invitation form, active administrators, pending invitations, and email support.
Founding churches see the exact approved no-payment wording. Sponsored churches see their separate
no-cost label. Ordinary churches see Standard access without either special label.
Ben's account review removes the standard-price line from every account state; public-release
pricing remains on the Pricing page.

The price-line removal passes 21 focused account, administrator, and authentication tests, scoped
lint, and the isolated production build. Browser checks cover all three access states at 390px and
1440px without overflow. Preview 4201 includes the change; captures are `no-price-390.png` and
`no-price-1440.png` in the account evidence folder.

WorkOS remains the membership authority. Every administrator can invite another full administrator,
revoke a pending invitation, and remove another church membership. Removal requires an inline
confirmation naming the email and church. Users cannot remove themselves. Successful actions refresh
the roster; a refresh failure preserves the success message and disables mutations until Retry
succeeds. Failed invitation requests preserve the email draft.

The server derives the organization from the authenticated session and verifies current membership.
The shared session loader performs the same check for the existing workflow, so removal takes effect
on the next request despite an unexpired AuthKit token. Provider outages deny access. Invitation
requests normalize email, reuse a pending invitation, coalesce concurrent sends within the existing
single application process, and check provider state after an uncertain send response.

Migration `029_church_access.sql` adds one constrained `access_kind` field. It backfills the existing
founder seed church and leaves other churches standard by default. Sponsored assignment remains a
founder maintenance action against an explicitly selected church. No browser endpoint edits labels,
and labels do not change product capabilities. No payment integration or trial timer was added.

## Verification

The canonical `pnpm check` ran against the exact application source in
`tmp/phase11-account-verification-20260906`. The isolated review server uses separate source, a copy
of existing demo geography, and synthetic WorkOS accounts. Those automated and fixture checks
changed no live invitations, memberships, or church data. The existing preview on port 4180, daily
build directory, and canonical environment files were untouched. The separately authorized real
staging check is recorded below.

| Check | Result |
|---|---|
| Application tests | 397 passed |
| Python launcher tests | 4 passed |
| Importer tests | 71 passed |
| Lint | 202 files, no findings |
| TypeScript | Passed |
| Default production build | Passed, including Account and administrator API |
| Access and authorization | Founding, sponsored, and standard states; foreign IDs and organization fields; expired membership; provider failures; self-removal; invitation retries and pagination |
| Account browser checks | Invite, duplicate submission, repeat invitation, revoke, remove, persistence after reload, cancel focus, retry, draft preservation, reduced motion |
| Responsive browser checks | 320, 390, 820, and 1440px; no overflow; account controls at least 44px |
| Core browser workflow | Generate, finalize, one-page PDF download, reconcile, Coverage, Outreach Progress, return to Account |
| Browser errors | None in the completed account and core checks |
| Impeccable detector | No findings |
| Independent finish review | `disposition: ship`; no material fixes |

The browser fixture initially resolved its data file from the launch directory, so its first roster
load failed. Correcting that isolated fixture path restored the actual roster. The core browser
script also needed to wait for workspace hydration and use the button's exact `Outreach progress`
label. Both completed checks passed after those harness corrections; neither required an application
change.

Evidence lives in `output/playwright/phase11-account/`: `canonical-check.log`,
`browser-results.json`, `core-results.json`, `impeccable-detector.json`, `core-packet.pdf`, and the
founding, sponsored, standard, confirmation, and retry screenshots. These generated artifacts and
the isolated projects are ignored by Git. The route brief is persisted at
`web/.impeccable/surfaces/app-account-page-tsx.md`.

## Impeccable finish verdict

Disposition: ship.

| Element | Assessment |
|---|---|
| Type | Match: existing Trebuchet operational character and navy hierarchy |
| Material | Match: cream surfaces, thin separators, existing lamp asset |
| Header and identity | Match |
| Navigation | Appropriate adaptation for a separate account destination |
| Reading order | Match: church, access, invite, roster, support |
| Desktop composition | Match |
| Phone composition | Appropriate stacking of sections and controls |
| Removal confirmation | Match |
| Recovery | Match |
| Scope and copy | Match |

The reviewer found no material fixes. Root `DESIGN.md` and its sidecar remain the authority for the
unchanged visual system.

## Real WorkOS staging check

Ben authorized the agent to use 10 Minute Mail and disposable test credentials on September 6.
The application ran from `tmp/phase11-workos-staging-20260906` on localhost port 3000, with a fresh
seeded SQLite database and a disposable WorkOS staging organization. Authentication, Account,
administrator API, and proxy source hashes matched the canonical application. Only the bootstrap
administrator was provisioned through the API; invitations, hosted signup, revocation, and removal
ran through the real browser interfaces.

| Check | Observed result |
|---|---|
| Delivery | Account reported `Invitation sent.`; 10 Minute Mail received the WorkOS staging invitation |
| Revocation | Account reported `Invitation revoked.`; the emailed link showed `Invalid invitation` in a separate browser session |
| Acceptance | A fresh invitation completed hosted name/password signup and the AuthKit callback; WorkOS reported `accepted` and an active membership |
| Invited administrator access | Coverage and Account loaded; Account showed both administrators and the invited user's own row had no Remove action |
| Removal | Account reported `Administrator removed.`; WorkOS retained the user but removed the church membership |
| Existing session after removal | The next Account request returned 404; `/api/account/administrators` and `/api/coverage` returned 403 without signing out first |
| Remaining administrator | The original disposable administrator retained Account access and saw only their own row |
| Cleanup | Both sessions signed out; the disposable organization and both users were deleted; follow-up reads returned 404; the original founder membership was unchanged |

The bootstrap account initially used `example.com`, which was already bound to an existing staging
test organization's authentication policy. An unbound reserved test domain resolved that setup
issue, and the automatically added membership was removed. The first browser login also outlived
its temporary sign-in cookie while awaiting approval; starting a fresh login completed successfully.
Neither setup issue required an application change. Browser navigation reported
`ERR_BLOCKED_BY_CLIENT` for the denied API pages; the local server recorded the expected 403 responses.

The disposable resource ledger is stored without its test password at
`tmp/phase11-workos-staging-20260906/web/data/workos-disposable.json`. Ben's password and canonical
church database were not used. The canonical database still needs migration during its authorized
deployment setup.

## Completed founder review

The local preview uses synthetic accounts. Invitations in this preview are simulated and send no
email. These links select an access state and open the actual Account interface:

- [Founding church](http://localhost:4201/review?access=founding)
- [Sponsored church](http://localhost:4201/review?access=sponsored)
- [Ordinary church](http://localhost:4201/review?access=standard)

Ben approved the public website and Account presentation, including removal of the standard-price
line. The automated, fixture-browser, and real staging checks now cover administrator management.
Phase 11 is complete. Ben still needs to choose the support email before release. Deployment and
recovery remain Phase 12 and have not started.

## AuthKit and email branding

Ben authorized these WorkOS staging appearance changes on September 6. Production remains a
Phase 12 task. The saved settings use light mode, Streetlight as the display name, Trebuchet MS
for AuthKit, and the Small corner-radius preset. The palette is background `#f6f1e5`, button
`#101a29`, button text `#fffdf7`, and links `#2767e9`.

The logo, logo icon, and favicon use [streetlight-logo.png](../web/public/branding/streetlight-logo.png),
a transparent 512px export of the existing 1024px `web/public/StreetlightLogo.png`. The export is
63,228 bytes and fits WorkOS's upload limits. The small landing-page logo was not saved to WorkOS.
AuthKit displays the full Logo option. Emails use the larger of the two logo display options.

[authkit.css](../web/branding/authkit.css) records the saved Header, Card, Primary button, and Text
field overrides. Paste each block's contents inside the corresponding fixed selector wrapper in
WorkOS's editor. These overrides give AuthKit the website's cream cards, 44px controls, 8px button
corners, and blue keyboard-focus outlines. The CSS is a configuration record, not an app import.

| Check | Observed result |
|---|---|
| Hosted sign-in | Sharp 512px source image, navy button, no horizontal overflow at 1646px and 390px |
| Password and recovery pages | Branding and controls fit the 390px viewport; no password or reset form was submitted |
| Email previews | Invitation, verification, and password reset display the lamp and Streetlight palette |
| Delivered email | September 6, 4:29 PM CEST invitation opened in Ben's Gmail; loaded logo, button `rgb(16, 26, 41)`, text `rgb(255, 253, 247)` |
| CSS lint | Direct local Biome check of `branding/authkit.css` passed |
| Invitation cleanup | Both Gmail preview invitations show Revoked in the staging dashboard |

WorkOS emails retain the provider's standard layout and system font. The delivered email uses
`-apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif`; AuthKit's custom CSS does not
apply to email. No custom email delivery service was added. Gmail grouped the previews and trimmed
repeated content; expanding that content showed the complete updated invitation.

Screenshots in `output/playwright/phase11-account/` include `authkit-login-desktop.png`,
`authkit-login-mobile.png`, `authkit-password-mobile.png`, `authkit-recovery-mobile.png`, the three
`email-*-branded-preview.png` captures, and `invitation-email-gmail-branded.png`.

Ben approved the branding and Phase 11 closeout. He then explicitly approved deleting the separate
Gmail preview organization, `org_01M1VFWVF24MFC99YVPX4TQ414`. The agent deleted it through the WorkOS
staging dashboard and verified that it disappeared from Organizations and its settings URL showed
`This page couldn't be found`. The founder church remained listed with one user. No user account
or founder membership was deleted. The support-email choice remains a pre-release follow-up.

## Pull request verification

The September 6 closeout check used a separate source copy at
`tmp/phase11-pr-verification-20260906`. The repository's `pnpm db:migrate`, `pnpm db:seed`, and
`pnpm check` commands passed there with pnpm 10.27.0 and Node.js 24.15.0. The check ran 397 application
tests, 4 Python-launcher tests, and 71 importer tests. Biome checked 203 files, TypeScript passed,
and Next.js built the public pages and Account routes. The log is
`output/playwright/phase11-account/pr-canonical-check.log`.

Rebasing onto the published maintenance commits retained their additional forward/reverse scroll
assertions. The complete `pnpm check` passed again with the same counts; its log is
`output/playwright/phase11-account/pr-rebase-check.log`.

Two independent reviews found no material issues in administrator management, public pages,
assets, and the accumulated maintenance changes. The staged diff passed Gitleaks and Git's
whitespace check. The PR retains the newer maintenance reports already published on `main`.
Generated screenshots remain local; the approved site assets and AuthKit configuration record
are included in version control. Production configuration and deployment remain Phase 12 work.
