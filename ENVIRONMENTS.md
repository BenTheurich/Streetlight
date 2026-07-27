# Environment variables

The local SQLite database is generated at `web/data/streetlight.db`.

Phase 2 supports these values in the ignored root `.env.local`:

| Variable | Used for | Required restrictions |
|---|---|---|
| `GOOGLE_MAPS_BROWSER_API_KEY` | Interactive administrator map | Maps JavaScript API and approved HTTP referrers only |
| `GOOGLE_MAPS_SERVER_API_KEY` | Server-side church-address geocoding | Geocoding API and server-origin restrictions; never exposed to the browser |
| `GOOGLE_MAPS_STATIC_API_KEY` | Phase 0/packet map proof and local geocoding fallback | Static Maps, Roads, and Geocoding APIs; never exposed to the browser |

The browser key is intentionally visible in the rendered map request and must be protected by
API and referrer restrictions. The server key and Static Maps key must never use a
browser-visible `NEXT_PUBLIC_` name.

Without `GOOGLE_MAPS_BROWSER_API_KEY`, Territory Setup renders a clear unavailable-map state
while database, test, and production-build commands continue to work. Address changes require
one of the server-side keys; the existing saved address and location remain usable without it.

Authentication configuration belongs to Phase 7. Production configuration belongs
to Phase 8.
