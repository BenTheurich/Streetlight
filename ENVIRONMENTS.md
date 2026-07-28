# Environment variables

The local SQLite database is generated at `web/data/streetlight.db`.

Phase 2 supports these values in the ignored root `.env.local`:

| Variable | Used for | Required restrictions |
|---|---|---|
| `GOOGLE_MAPS_BROWSER_API_KEY` | Interactive administrator map | Maps JavaScript API and approved HTTP referrers only |
| `GOOGLE_MAPS_SERVER_API_KEY` | Server-side church-address geocoding | Geocoding API and server-origin restrictions; never exposed to the browser |
| `GOOGLE_MAPS_STATIC_API_KEY` | Phase 0/packet map proof and local geocoding fallback | Static Maps, Roads, and Geocoding APIs; never exposed to the browser |
| `STREETLIGHT_PYTHON` | Optional Overture importer executable | Set only when `python` is not the desired executable |

The browser key is intentionally visible in the rendered map request and must be protected by
API and referrer restrictions. The server key and Static Maps key must never use a
browser-visible `NEXT_PUBLIC_` name.

Without `GOOGLE_MAPS_BROWSER_API_KEY`, Territory Setup renders a clear unavailable-map state
while database, test, and production-build commands continue to work. Address changes require
one of the server-side keys; the existing saved address and location remain usable without it.

Install the pinned importer dependency with:

```powershell
python -m pip install -r web/importer/requirements.txt
```

Overture import requires network access to its public S3 data but no API key. Streetlight
explicitly uses anonymous access and does not reuse ambient AWS credentials.

Authentication configuration belongs to Phase 7. Production configuration belongs
to Phase 8.
