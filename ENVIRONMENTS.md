# Environment variables

Phase 1 requires no application environment variables or external credentials.
The local SQLite database is generated at `web/data/streetlight.db`.

The ignored root `.env.local` is used only by the Phase 0 proof scripts for
`GOOGLE_MAPS_STATIC_API_KEY`. No browser-visible map key is part of Phase 1.

Authentication configuration belongs to Phase 7. Production configuration belongs
to Phase 8.
