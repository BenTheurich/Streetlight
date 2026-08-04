# Public site, trial, and subscription experience

Status: founder review  
Direction agreed in conversation: 2026-08-04

## Purpose

Streetlight needs a humane path from learning about the product to trying it and, later, paying
for it. The path must make the founder visible, keep pricing from intruding on the landing page's
mission-led story, give a church enough time to complete a real outreach cycle, and prevent the
founder from becoming unpaid general-purpose IT support.

Streetlight is a small B2B SaaS product: a church receives one workspace and its administrators use
it on the church's behalf. It is not a consumer app and does not need public self-service signup.

## Timing

This document records future direction; it does not add work to Phase 9.

1. Finish Phase 9 without adding public pages, trials, subscriptions, or billing.
2. Deploy and prove recovery in Phase 11 without payments, as the implementation plan requires.
3. Complete the founder-church pilot in Phase 12 and record actual hosting, map, printing, and
   support costs.
4. After Phase 12, implement the public trust pages first, then trial and subscription access.
5. Add sponsored-access reporting only after real sponsored and paying churches exist.

The exact monthly and annual prices remain a founder decision after Phase 12 evidence. The product
will have one paid plan, annual billing presented first, and a monthly alternative. No production
pricing page launches with placeholder amounts.

## Public site

The existing landing page remains focused on Streetlight's mission, the paper-based workflow, and
requesting access. It does not contain a pricing section.

Once the supporting pages are ready, the public navigation contains:

- **How it works**
- **Why Streetlight**
- **Pricing**
- **Admin login**
- **Request access**

Pricing is a separate public page rather than an invitation-only secret. It appears in navigation
only when How it works and Why Streetlight are also published, so pricing is part of a credible
product site rather than the only destination beyond the landing page.

### How it works

This page explains the real administrator workflow with product screenshots:

1. Define the church's outreach territory.
2. See which streets have waited longest.
3. Generate connected packet proposals.
4. Print one paper map per volunteer assignment.
5. Reconcile the returned sheets so the map remembers completed outreach.

The page explains that volunteers need no account or phone. It does not introduce features outside
`PRODUCT.md` or make claims about people reached, volunteer performance, or spiritual outcomes.

### Why Streetlight

This single page serves as both the founder About page and the story of why the product exists. It
contains:

- a photograph and short introduction from the founder;
- the story that Streetlight began as software for the founder's own church;
- the problem of recently covered streets being repeated while older streets are forgotten;
- why paper remains part of the volunteer workflow;
- the commitment to deterministic, reviewable behavior and limited church data;
- a plain statement that sustainable pricing funds hosting, maintenance, and bounded support.

Do not split this material into padded About and Why pages.

### Pricing

The pricing page follows the human pattern of the Amy Food Journal reference without copying its
visual design or wording. It contains:

- one plan with annual billing first and monthly billing second;
- the 90-day free-trial terms and a clear `No credit card required` statement;
- one feature summary because every paying, founding, and sponsored church receives the same
  product;
- the included support boundary;
- a founder note with a photograph and signature;
- a short explanation of sponsored access;
- frequently asked questions.

The founder note explains that Streetlight was first built for the founder's church, that reliable
hosting and maintenance cost real time and money, and that subscriptions keep the service
dependable while helping make sponsored access possible. Streetlight does not use ads or sell
church data.

The FAQ answers:

- Is there a free plan? **No.**
- How does the free trial work? **Ninety days, full access, no credit card.**
- What happens when the trial ends? **The church's data is preserved and operational access waits
  for a subscription.**
- Can a church receive sponsored access? **A limited number may, at the founder's discretion.**
- What support is included? **Streetlight product support by email.**
- What happens after cancellation? **Paid access continues through the paid period and data is not
  silently deleted.**

Privacy, terms, and contact links live in the public footer before paid subscriptions launch.

## Access journey

Public signup remains disabled. A church requests access, the founder reviews the request, and an
approved administrator receives the existing WorkOS invitation.

### Trial

- Every newly approved ordinary church receives a 90-day free trial.
- No credit card is collected before or during the trial.
- The trial begins when the church first saves its territory, not when the invitation is sent.
- The church receives the complete product during the trial, including finalizing and printing
  packets and reconciling completed outreach.
- Streetlight never waits until printing to reveal a paywall.
- The account page always shows the trial end date. Calm in-app reminders appear near expiration.

Ninety days is intentionally longer than a consumer-app trial because a church must have time to
configure its territory and complete a real outreach-and-reconciliation cycle.

### Trial expiration

At expiration, Streetlight applies one church-wide access decision at the authenticated workspace
boundary. It does not scatter plan checks through printing, packet generation, or reconciliation.

The expired church can sign in, see that its data is preserved, open account and subscription
information, and subscribe. Operational tools remain unavailable until access resumes. Expiration
never deletes church data or alters reservations, packets, or coverage history.

### Paid access

Streetlight uses a hosted checkout and hosted subscription-management portal from the selected
payment provider. It does not build custom card forms, invoices, or payment-method management.

A successful provider notification activates the church. Cancellation keeps access active through
the paid-through date. A transient provider outage or an unconfirmed payment problem does not
immediately revoke access; Streetlight retains the last confirmed state until the provider reports
an effective end date.

## Account language and page

The existing administrator menu gains one **Account** link. One account page shows the church's
access state and the appropriate next action. It does not become a general settings area.

User-facing states are:

- **Free trial**: full access through a displayed date.
- **Active subscription**: monthly or annual, with the next renewal date and a manage-subscription
  action.
- **Founding church access**: the founder's church uses Streetlight at no cost and no payment is
  required.
- **Sponsored access**: the church has full access at no cost.
- **Payment issue**: payment management is needed, without claiming access has ended prematurely.
- **Subscription ended**: operational access is paused and the church can subscribe again.

`Comped` may be used as an internal implementation term but never appears to a church.

Example founding-church copy:

> **Founding church access**  
> Streetlight is provided to your church at no cost. No payment is required.

Example sponsored-access copy:

> **Sponsored access**  
> Your church has full access to Streetlight at no cost.

## Support boundary

The paid plan includes email support for Streetlight itself:

- product defects;
- account-access problems;
- Streetlight-caused data or workflow problems;
- questions about using the documented Streetlight workflow.

It does not include emergency or on-call support, general computer or browser support, printer or
Wi-Fi troubleshooting, Google-account support, bespoke territory cleanup, custom maps, or
individual training engagements. The pricing page states the boundary plainly without sounding
hostile.

Do not add a support-ticket platform for launch. A published support email is sufficient until its
volume proves otherwise.

## Sponsored access

Sponsored and founding churches receive the same features as paying churches. Access state must
never weaken reservation, reconciliation, correction, isolation, or data-integrity behavior.

Streetlight may later show truthful aggregate language such as:

> Paid subscriptions currently help make Streetlight available to 3 sponsored churches.

That count may appear only when it is derived from real access records. Streetlight does not:

- identify a sponsored church publicly or to another customer;
- collect or display its membership count for this purpose;
- claim that one subscriber funds a precise percentage of another church;
- promise a fixed one-for-ten sponsorship ratio before finances support it;
- add a donation ledger or per-subscriber allocation system.

Before a real aggregate count exists, use general wording: `Paid subscriptions help make sponsored
access possible.`

## Minimal data model

One church has one access state. The existing `churches` record is extended with only the fields
required to answer that question, such as:

- access kind;
- trial start and end timestamps;
- paid-through timestamp;
- payment-provider customer and subscription identifiers.

The selected payment provider remains authoritative for payment processing. Streetlight stores the
minimum confirmed state needed to enforce access without making a provider request on every page
load. Signed provider notifications update that state idempotently.

Founding and sponsored access are founder-controlled church states and require no fake subscription,
coupon, or payment-provider customer.

## Access enforcement and safety

- Access is checked server-side from the authenticated church, never from a browser-supplied church
  identifier.
- One shared guard protects operational pages and mutations; individual tools do not invent their
  own billing rules.
- Provider notifications require signature verification and safe replay handling.
- Trial expiration, cancellation, and payment problems never delete or rewrite church data.
- Cross-church isolation remains unchanged.
- A billing failure cannot leave a partially finalized batch or partially reconciled packet.

## Checks

The later implementation leaves focused checks proving:

- the 90-day trial starts on the first successful territory save and cannot be restarted;
- a trial church has complete workflow access before expiration;
- an expired church cannot perform operational mutations or generate new output;
- founding and sponsored churches bypass payment without bypassing authentication or isolation;
- an active subscription works until its confirmed paid-through date;
- cancellation and provider retries are idempotent;
- payment-provider failures do not corrupt workflow data;
- the account page shows the correct plain-language state and action;
- public pages have accessible headings, navigation, links, and responsive layouts;
- sponsored counts, if displayed, are aggregate and derived from real records.

## Deliberate exclusions

- Pricing content inside the landing-page body
- Public self-service signup
- A permanent public free plan
- Feature tiers, usage quotas, or administrator limits
- A print-only paywall
- Custom payment forms or subscription-management UI
- Named sponsorship stories without a separate, explicit founder and recipient decision
- Per-subscriber sponsorship percentages
- Membership-count collection
- Automated CRM, sales sequences, or a support-ticket platform
- Implementation during Phase 9, Phase 11, or before the Phase 12 pricing review

## Completion condition

After the founder-church pilot, the founder selects exact prices and a payment provider from real
evidence. The three workstreams are then implemented and reviewed in order:

1. How it works, Why Streetlight, and Pricing public pages
2. Trial, account, hosted checkout, and church-wide access enforcement
3. Aggregate sponsored-access messaging after real data exists
