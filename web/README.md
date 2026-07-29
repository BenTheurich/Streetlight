# Streetlight application

Next.js 16 App Router application with SQLite and invite-only WorkOS AuthKit authentication.

Use the canonical root commands documented in the repository [README](../README.md).
See [ENVIRONMENTS](../ENVIRONMENTS.md) for the Google Maps and WorkOS staging values.

`/login` starts the hosted WorkOS email/password flow. Public signup and social login stay
disabled in WorkOS. Each authenticated WorkOS organization must map to exactly one Streetlight
church and its single territory; unmapped users cannot enter the administrator workspace.
