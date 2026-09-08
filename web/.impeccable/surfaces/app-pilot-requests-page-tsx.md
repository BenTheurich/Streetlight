---
version: 1
slug: "app-pilot-requests-page-tsx"
primary_target: "app/pilot-requests/page.tsx"
related_targets: ["components/PilotRequestReview.tsx","components/AdministratorPage.tsx","app/administrator-page.css","app/pilot-requests/pilot-requests.css"]
---

# Access requests

Mode: Operate. This founder-only page reviews requests for pilot access. Keep the existing server authorization and provisioning rules.

Use AdministratorPage for the same lamp header, account menu, content width, and operational typography as Church account. Keep the header pinned to the top while the page scrolls. Group pending and incomplete approvals under Needs review. Keep declined and approved requests under Reviewed in collapsed native disclosures. Church name, contact, location, and decision remain visible when collapsed. Within an expanded request, place context beside the approval form; stack them at 700px and below.

Decline is available only for pending requests. It shows Declining while saving, then moves the request to Reviewed, announces that no invitation was sent, updates the menu count, and focuses the outcome. Declined requests may still be approved. Incomplete approvals offer Continue approval. Approved requests show the invitation outcome without another form. Errors appear beside the relevant action and preserve entered corrections.

The menu mismatch and misleading repeat-Decline action have regression coverage in rendered-contracts.test.mjs and PilotRequestReview.test.mjs. Isolated browser checks at 1440px, 768px, and 390px cover loading, failed decline and retry, persisted decline, later approval, incomplete approval, empty state, and keyboard focus. Local captures are in output/playwright/account-access/. Provider calls use a fake adapter and the database is disposable.
