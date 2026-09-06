# Supporting public pages audit

Reviewed and revised September 5, 2026. Scope: How it works, Why Streetlight, and Pricing,
including Pricing's FAQ. The approved landing layout, styles, and animation remain unchanged;
Ben's follow-up removes its single demonstration-data label.

The review follows Impeccable's audit and layout guidance, the existing landing's visual system,
and the approved [public-site specification](superpowers/specs/2026-08-04-public-site-trial-subscription-design.md).
The approved sections and wording are preserved except for the introductory How it works pitch,
screenshot captions, and public sponsorship promotion Ben explicitly removed during review. Where the first implementation
shortened other approved wording, this revision restores it.

## Findings and changes

| Severity | Finding | Result |
|---|---|---|
| P1 | At 820px, minimum grid widths pushed content offscreen on every supporting page. The outer clipping rule concealed it. | Shrinkable columns and earlier stacking keep all content inside the viewport. The outer clipping rule is removed. |
| P2 | Oversized headings and repeated section spacing gave minor and major passages similar weight. | Smaller section headings, grouped workflow steps, and closer image/copy placement establish a clearer reading order. |
| P2 | Pricing separated the billing choices from the shared feature list with a full-width dark section. | One plan presentation keeps annual-first pricing, monthly billing, one Request access action, and all eight inclusions together. |
| P2 | Approved prose had been shortened, including the phone-free packet explanation and parts of the founder story. | Full workflow descriptions, founder passages, and FAQ answers are restored from the specification. |
| P2 | Why's yearly frames showed only statistics; its memory section used a packet-selection image. How's presentation and print examples showed different records. | Why now shows three complete presentation frames and the coverage map. How's presentation and print report use the same completed demo record. |
| P2 | Header and footer links fell below the project's 44px target-height requirement. | Navigation and action targets now meet that height on tested widths. Inline prose links retain ordinary text sizing. |

Existing server-rendered pages, native FAQ disclosures, active navigation, and image descriptions
were retained. Request access now opens a drawer on the current supporting page.

## Founder-requested revisions

- Restored the church marker in all four new progress images. The capture fixture attached the
  map adapter but omitted the base presentation that registers the marker; the application itself
  already performed that step. The corrected capture uses the production marker and coordinates.
- Put How's presentation and printed report beside each other under the section introduction,
  with responsive stacking on phones. Removed explanatory screenshot captions and demo labels.
  Why's three short sequence labels remain to distinguish the frames.
- Removed the public sponsored-access section and its FAQ. Internal sponsored access behavior
  remains unchanged.
- Added smooth anchor scrolling, restrained map and paper entrances, and animated FAQ opening
  and closing. Reduced-motion preferences make these interactions immediate.
- Added the approved access form to each supporting page in a native modal drawer, with smooth
  opening and closing, keyboard containment, Escape and backdrop dismissal, and focus restoration.
  The drawer preserves the current URL and scroll position. Existing validation, request fields,
  pending state, error/retry, and success behavior use the existing API.

## Audit health

These are bounded audit judgments, not a WCAG certification.

| Dimension | Before | After | Evidence |
|---|---:|---:|---|
| Accessibility | 2/4 | 3/4 | Visible keyboard focus, working skip link, all seven disclosures operable with Enter, larger navigation targets, and native modal controls. Screen-reader testing was not performed. |
| Performance | 3/4 | 3/4 | Server-rendered content, Next Image sizing, lazy loading below the opening, no new client library. Real progress frames add approximately 919KB of source assets before Next optimization. |
| Responsive design | 1/4 | 4/4 | No clipping or broken imagery in 320px, 390px, 820px, and 1440px captures. The regression check also covers 1024px with FAQ answers open. |
| Theming | 3/4 | 4/4 | Page-scoped colors inherit the existing paper, ink, panel, muted, amber, and focus tokens. No global or landing stylesheet edits. |
| Implementation integrity | 2/4 | 4/4 | Approved copy restored with Ben's requested removals; required imagery and church markers present. |
| Total | 11/20 | 18/20 | Significant initial gaps addressed. |

Muted body text measures 5.20:1 against paper and 5.76:1 against bright paper. Copper text measures
5.37:1 against paper; secondary text on the night background measures 13.19:1.

At the same 1440px capture width, Why Streetlight's page height changed from 6,335px to 4,334px,
and Pricing's from 4,439px to 2,838px in the first pass, while restoring the approved passages.
After Ben's requested removals, the pages measure 4,160px and 2,628px respectively.

## Product image provenance

The four new `story-progress-*.webp` assets come from a copy of the existing isolated outreach
demo database, rendered with the product's progress calculations, map style, overlay code,
presentation component, and print styling. No real church records were changed.

The presentation frames show 8, 26, and 52 recorded outreach dates. The completed presentation
and printed report both show 52 packets, 583 streets, and 9,010 estimated homes through August 28,
2026. These are demonstration values, not customer outcomes. Existing landing assets are unchanged.

Capture scripts and provenance are in `output/playwright/progress-proof/`. Before/after images,
legible screenshot crops, viewport measurements, and verification logs are in
`output/playwright/public-audit/`.

## Initial verification

| Check | Result |
|---|---|
| Biome | 180 files checked, no fixes needed |
| TypeScript | Pass |
| Application Node tests | 364 passed |
| Python launcher tests | 4 passed |
| Python importer tests | 71 passed using the existing prepared interpreter |
| Default production build | Pass; all three public pages prerendered |
| Browser interactions | Skip link, six workflow anchors, and the original eight keyboard-operated FAQs verified |
| Landing preservation | Initial pass preserved PublicLanding, its CSS and script, the root page, global styles, and root layout |

Build and code checks ran in an isolated source copy. The daily build directory, running
application, environment files, and live databases were left alone. An optional webpack build
reported existing API-route helper-export type errors; the canonical default Turbopack build
passes without changes to those routes.

## Follow-up verification

- Biome checked 187 files without findings; TypeScript and the default production build passed.
- The 376-test application run passed 375 tests and found one incorrect new test assertion about
  React's boolean data-attribute serialization. After changing the assertion to check attribute
  presence, all nine tests in that contract file passed.
- Drawer tests cover desktop, mobile, reduced motion, native validation, pending state, mocked
  failure and retry, success, keyboard containment, and URL, scroll, and focus restoration.
- FAQ tests cover keyboard opening and closing, rapid reversal, and reduced-motion changes.
- Ben's subsequent motion refinement replaces timed image entrances with scroll-controlled
  paper movement and presentation reveals. Scrolling backward reverses them; stopping holds
  the current frame. The three focused public-page tests pass, including desktop/mobile scroll
  reversal and reduced-motion restoration. Intermediate captures at 320px, 390px, and 1440px
  show no horizontal overflow. Evidence is in `output/playwright/public-audit/scroll-motion/`.
- All seven Request access triggers across the three built pages open in place at both 1440px
  and 390px. Production-browser checks report no page errors. No form requests were submitted.
- Fresh captures at 320px, 390px, 820px, and 1440px show no overflow or broken imagery. The
  Impeccable detector and the independent follow-up review found no material issues.
- Starting hashes still match the landing CSS and script, root page, global styles, and layout.
  A source comparison confirms the only landing component edit removes the demo-data label.

Logs and production-browser captures are in `output/playwright/public-audit/revision/`.
The isolated production preview uses synthetic local auth settings and no real credentials or
database. The existing development server and build directory remain untouched.

## Independent design review

Disposition: **ship**. No material fixes remain from the independent Impeccable finish review.

| Reviewed element | Verdict |
|---|---|
| Type and materials | Match |
| Palette and controls | Match |
| How, Why, and Pricing reading order | Match |
| Responsive layout | Appropriate adaptation of the approved identity |
| First viewport | Match |
| Material fixes | None |

## Founder review

Review the three supporting pages and their copy in the isolated preview. Phase 11 remains in
progress at the existing public-site review checkpoint. Account, administrator management,
deployment, and billing work remain outside this change.

The public support email is still undecided. Ben confirmed that the documented
`support@streetlight.example` placeholder should remain a release follow-up. Replace it before
publishing a working contact destination.
