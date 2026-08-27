# Apartment V1 Simplification

Status: founder-approved design; implementation pending

## Goal

Keep apartment evidence visible and available for outreach without making administrators learn an
apartment-specific review workflow. An apartment site stays out of packet generation until an
administrator deliberately includes it.

## V1 product model

Apartment evidence and proposed site grouping continue to come from the deterministic Overture
import. Apartment evidence does not contribute to adjacent street tract estimates.

The Setup list exposes only two user-facing states:

- **Not included**: the default. The site remains visible in Setup but cannot enter packet
  generation or field-facing output.
- **Included**: the administrator has supplied the required packet facts and accepted the site's
  current building membership.

Do not expose `Needs setup`, `Packet ready`, a review status, or a separate readiness concept in the
V1 interface.

## Admin flow

Selecting an apartment site shows:

- its current building count, with **Edit buildings** for the occasional incorrect grouping;
- a primary starting address;
- a positive tract quantity;
- access as an explicit choice between **Open** and **Restricted**; and
- **Include in packet generation**.

Do not ask the administrator to enter a complex name, confirm the building grouping with a separate
checkbox, or confirm the address with a separate checkbox. A source-provided name may remain in
stored evidence, but it is not required or editable in V1.

The inclusion control is unavailable until address, tract quantity, and access are valid. Turning it
on confirms the current building membership and address as part of the same deliberate action. If a
required value is later cleared, inclusion turns off automatically. Editing the site's building
membership also turns inclusion off because the saved tract quantity may no longer describe the
revised complex; the administrator can review the values and turn inclusion on again.

All apartment edits autosave independently from Region Setup Save and Cancel. The existing
confirmed-failure rollback, retry, and uncertain-result reload recovery remain.

## Grouping

Streetlight continues to propose a multi-building site only from an explicit apartment land-use
boundary. Otherwise evidence begins as a one-member site. Nearby buildings are never grouped only
because they are close.

Grouping is a correction tool rather than a required ceremony. The administrator may combine
buildings or edit an existing site's membership from the map. Saving membership is itself an
intentional grouping action; no second confirmation is required. Removed evidence returns as a
separate not-included site and is never discarded.

## Backend behavior

Packet eligibility requires all of the following:

1. the site is inside the saved region;
2. a nonempty starting address is stored;
3. a positive integer tract quantity is stored;
4. access is `Open` or `Restricted`;
5. the site is included; and
6. no active packet already reserves it.

Existing grouping- and address-confirmation columns may remain for migration and history
compatibility, but they cease to be separate administrator decisions. The server derives them from
membership saves and the inclusion action. Legacy review-status fields do not control eligibility.

Confirmed sites and their configuration continue to survive a later import. Historical packet and
coverage references remain unchanged.

## Packet behavior

One included apartment site remains one atomic apartment packet. It is never combined with streets
or split by building in V1. The administrator-entered tract quantity controls packet selection and
printing. Restricted sites retain the packet access warning. Reconciliation records one completion
date for the complete site.

Splitting large complexes, allocating tracts to individual buildings, drawing custom complex
boundaries, and partial apartment completion remain outside V1.

## Validation

- Import checks continue to prove that apartment evidence does not increase adjacent street counts.
- Route and database checks prove that incomplete sites cannot be included and invalidation turns
  inclusion off.
- Membership checks prove that a building cannot belong to two included/confirmed sites and removed
  evidence is restored.
- Packet checks prove that only valid included sites participate and remain atomic.
- UI checks cover the two visible states, autosave recovery, optional grouping correction, and
  inclusion persistence without either confirmation checkbox.
- A signed-in browser pass covers a single-building site, a proposed multi-building site, grouping
  correction, inclusion, invalidation, reload persistence, and packet generation.
