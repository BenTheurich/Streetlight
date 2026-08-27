# Phase 8 pilot access and onboarding design

Status: approved founder decision
Approved: 2026-07-29

## Goal

Move one church from a public pilot request to an invited, authenticated, correctly scoped
Streetlight workspace without manual database changes.

## Public landing and request

The approved `spread-the-light-v2` prototype becomes the real signed-out `/` page. Its Admin login
control opens WorkOS and every Request pilot access control opens the existing accessible drawer.
Signed-in configured administrators continue to see the map workspace at `/`.

The request form stores church name, contact name, email, city/state, and an optional current
outreach description. Church name, contact name, email, and city/state are required. Server-side
length, email, and exact-object validation is authoritative. A hidden honeypot rejects automated
submissions without adding CAPTCHA.

One normalized church-name and email pair identifies a request. Repeated submissions create no
additional row and return the same neutral success response:

> Request received. We'll review it and contact you at {email}.

The response never reveals whether a request is pending, declined, or approved.

## Founder review

The deployment configures one founder email. That signed-in account sees a Pilot requests item and
pending count in the account menu. A dedicated founder-only page lists pending requests first and
can show all states. Ordinary church administrators receive `404` for the page and its APIs.

The founder may correct the church name and invitation email, then explicitly approve and send the
invitation. Decline records the decision without sending an email. A declined request may still be
approved later.

## Provisioning

Approval uses the request ID as the stable local and WorkOS external identity:

1. Reserve one provisional church locally.
2. Create or find the corresponding WorkOS organization.
3. Save the organization ID on that church.
4. Create or find one organization-specific invitation for the corrected email.
5. Record the invitation ID and approved state.

Each step records enough state for the same action to resume safely after a partial failure. It
never creates a second church, organization, or invitation for one request. WorkOS sends the
invitation email; Streetlight adds no email provider.

## First sign-in

An authenticated organization may resolve to either a configured workspace or a provisional church.
A provisional church is routed to onboarding instead of the map workspace. The administrator
confirms:

- church name, prefilled from approval;
- complete church address, validated through the existing Google geocoder;
- browser-detected IANA time zone, editable before submission.

Submission creates the church's only territory as a one-mile circle centered on the geocoded
address. Its neutral name is `Outreach territory`, and it contains no imported streets. The
administrator enters Territory Setup immediately. Coverage, packet generation, and reconciliation
remain unavailable until the first territory save succeeds. The explicit save—not onboarding—may
launch the initial Overture import.

Existing configured workspaces are unchanged.

## Failure handling

- Public validation errors stay in the drawer and preserve entered values.
- Duplicate public submissions return success.
- Founder actions display concrete retryable failures without changing a request to approved early.
- Invalid onboarding addresses or time zones are rejected without creating a territory.
- Provisioning and onboarding writes are transactional within SQLite. WorkOS side effects use
  stored external IDs and invitation IDs for retry safety.

## Verification

Automated checks cover public validation and deduplication, founder-only access, decline and later
approval, resumable provisioning, one organization invitation, provisional session routing,
onboarding validation, one-mile territory creation, and existing-workspace bypass.

The final human check submits the real landing drawer, approves the request as the founder, accepts
one real WorkOS invitation in a second browser session, completes onboarding, and reaches Territory
Setup. Automated tests use fakes and do not send a live invitation.
