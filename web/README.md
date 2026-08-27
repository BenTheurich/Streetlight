# Streetlight application

Next.js 16 App Router application with SQLite and invite-only WorkOS AuthKit authentication.

Use the canonical root commands documented in the repository [README](../README.md).
See [ENVIRONMENTS](../ENVIRONMENTS.md) for the Google Maps and WorkOS staging values.

`/login` starts the hosted WorkOS email/password flow. Public signup and social login stay
disabled in WorkOS. Each authenticated WorkOS organization must map to exactly one Streetlight
church. Signed-out `/` shows the public landing page, whose pilot form stores a review request but
does not create an account.

The configured founder can review requests at `/pilot-requests`. Approval creates one WorkOS
organization and invitation using resumable database state. A newly invited administrator enters
church/address/time-zone onboarding, then sees only Territory Setup until the first explicit save
imports streets and unlocks the other tools.
