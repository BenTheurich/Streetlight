# Phase 8 Pilot Access and Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move one church from a public pilot request through founder approval and WorkOS
invitation into first-sign-in territory setup without manual database changes.

**Architecture:** SQLite owns request and provisioning state; WorkOS owns organizations,
invitations, identities, and sessions. Signed-out `/` renders the approved landing prototype,
while authenticated organization sessions resolve to onboarding, setup-only, or configured
workspace access.

**Tech Stack:** Next.js 16 App Router, React 19, Node SQLite, WorkOS AuthKit/Node SDK, Google
geocoding, Node test runner.

## Global Constraints

- Keep Streetlight deterministic and AI-free.
- Keep public signup disabled; a pilot request never creates an account.
- Add no provider, CAPTCHA, CRM, billing, or arbitrary email delivery.
- Use one-mile circular drafts and require an explicit territory save before the first import.
- Do not send a real WorkOS invitation during automated verification.
- Preserve existing configured workspaces and the approved landing prototype.

---

### Task 1: Pilot request persistence

**Files:**
- Create: `web/db/migrations/020_pilot_access_onboarding.sql`
- Create: `web/lib/pilot-requests.ts`
- Create: `web/lib/pilot-requests.test.ts`
- Modify: `web/lib/database.ts`
- Modify: `web/db/database.test.mjs`

**Interfaces:**
- Produces: `parsePilotRequest(value): PilotRequestInput`
- Produces: `submitPilotRequest(input, filename?): { requestId: string; email: string }`
- Produces: `listPilotRequests(filename?): PilotRequest[]`
- Produces: `declinePilotRequest(id, filename?): PilotRequest`
- Produces: resumable provisioning-state database functions keyed by request ID

- [x] Write failing tests for exact input validation, normalized church/email deduplication,
  neutral duplicate success, pending-first listing, decline, and later approval eligibility.
- [x] Run `pnpm --dir web test` and confirm the new tests fail.
- [x] Add the strict migration and minimal database functions. Existing churches receive a
  non-null onboarding completion timestamp; newly provisioned churches remain incomplete.
- [x] Run the focused tests and database migration suite until they pass.
- [x] Commit `feat: persist pilot access requests`.

### Task 2: Real public landing request

**Files:**
- Create: `web/components/PublicLanding.tsx`
- Create: `web/components/PublicLanding.test.mjs`
- Create: `web/app/api/pilot-requests/route.ts`
- Create: `web/app/api/pilot-requests/route.test.ts`
- Copy: approved V2 CSS, JavaScript, and WebP assets into `web/public/landing/`
- Modify: `web/app/page.tsx`

**Interfaces:**
- Consumes: `submitPilotRequest`
- Produces: public `POST /api/pilot-requests`
- Produces: signed-out landing at `/`

- [x] Write failing route tests for valid, invalid, honeypot, and duplicate requests plus a
  component check for every approved field and control.
- [x] Run the focused tests and confirm failure.
- [x] Port the approved V2 markup and assets without redesigning it. Update only the drawer submit
  behavior to call the API, retain values on error, and show the approved neutral success copy.
- [x] Make `/` choose public landing for a missing WorkOS user without redirecting to `/login`.
- [x] Run focused tests, lint, and TypeScript.
- [x] Commit `feat: connect public pilot request landing`.

### Task 3: Founder review and resumable WorkOS provisioning

**Files:**
- Create: `web/lib/founder-auth.ts`
- Create: `web/lib/founder-auth.test.ts`
- Create: `web/lib/workos-provisioning.ts`
- Create: `web/lib/workos-provisioning.test.ts`
- Create: `web/app/pilot-requests/page.tsx`
- Create: `web/components/PilotRequestReview.tsx`
- Create: `web/app/api/founder/pilot-requests/route.ts`
- Create: `web/app/api/founder/pilot-requests/route.test.ts`
- Modify: `web/components/AdministratorAccount.tsx`
- Modify: `web/components/AdministratorAccount.test.mjs`

**Interfaces:**
- Produces: `requireFounderSession(loadSession?, founderEmail?): AdministratorUser`
- Produces: `provisionPilotRequest(requestId, corrections, adapter?, filename?): Promise<PilotRequest>`
- WorkOS adapter methods: `findOrCreateOrganization(externalId, name)` and
  `findOrCreateInvitation(organizationId, email)`

- [x] Write failing tests proving ordinary administrators receive `404`, the founder can list and
  decline, approval applies corrections, partial provisioning resumes, and retries create one
  church/organization/invitation.
- [x] Run focused tests and confirm failure.
- [x] Implement founder email configuration, the account-menu badge/link, pending-first review
  page, exact action parsing, and the smallest WorkOS adapter over the installed SDK.
- [x] Store every external ID before moving to the next provisioning state. Mark approved only
  after the invitation ID is stored.
- [x] Run focused tests, lint, and TypeScript.
- [x] Commit `feat: add founder pilot approvals`.

### Task 4: First-sign-in onboarding and setup gate

**Files:**
- Create: `web/lib/onboarding.ts`
- Create: `web/lib/onboarding.test.ts`
- Create: `web/components/ChurchOnboarding.tsx`
- Create: `web/app/api/onboarding/route.ts`
- Create: `web/app/api/onboarding/route.test.ts`
- Modify: `web/lib/auth.ts`
- Modify: `web/lib/authenticated-route.ts`
- Modify: `web/lib/database.ts`
- Modify: `web/app/page.tsx`
- Modify: `web/components/StreetlightWorkspace.tsx`
- Modify: `web/app/api/territory/route.ts`

**Interfaces:**
- Produces: organization access state `missing | onboarding | setup | configured`
- Produces: `parseOnboardingInput(value): { churchName; address; timeZone }`
- Produces: authenticated `POST /api/onboarding`
- Produces: one-mile `Outreach territory` and setup-only workspace

- [x] Write failing tests for provisional-session routing, exact onboarding validation, valid IANA
  time zones, geocode failure, atomic one-mile territory creation, duplicate submission, existing
  workspace bypass, and first successful territory save unlocking all tools.
- [x] Run focused tests and confirm failure.
- [x] Implement the minimum organization-access resolver and onboarding transaction. Use existing
  Google geocoding and territory geometry helpers.
- [x] Render onboarding at `/` for a provisional church. Render only Territory Setup until its
  first save; hide and server-gate the other tools.
- [x] Run focused tests, the complete suite, lint, TypeScript, and production build.
- [x] Commit `feat: onboard invited pilot churches`.

### Task 5: Phase evidence and handoff

**Files:**
- Modify: `IMPLEMENTATION_PLAN.md`
- Modify: `ENVIRONMENTS.md`
- Modify: `web/README.md`

- [x] Document `STREETLIGHT_FOUNDER_EMAIL`, public/request behavior, and the live review steps
  without recording secrets.
- [x] Record automated counts and set Phase 8 to `Awaiting human review`.
- [x] Verify the complete diff against the approved design and resolve every Important review
  finding.
- [x] Commit `docs: record phase 8 verification`.
- [x] Leave the real WorkOS invitation unsent and report the exact founder browser check.
