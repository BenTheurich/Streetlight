# Environment variables

The local SQLite database is generated at `web/data/streetlight.db`.

Store local values in the ignored `web/.env.local` file:

| Variable | Used for | Required restrictions |
|---|---|---|
| `GOOGLE_MAPS_BROWSER_API_KEY` | Interactive administrator map | Maps JavaScript API and approved HTTP referrers only |
| `GOOGLE_MAPS_SERVER_API_KEY` | Server-side church-address geocoding | Geocoding API and server-origin restrictions; never exposed to the browser |
| `GOOGLE_MAPS_STATIC_API_KEY` | Phase 0/packet map proof and local geocoding fallback | Static Maps, Roads, and Geocoding APIs; never exposed to the browser |
| `STREETLIGHT_PYTHON` | Optional Overture importer executable | Set only when `python` is not the desired executable |
| `WORKOS_CLIENT_ID` | WorkOS AuthKit application | Staging client ID for local work; production value only in Railway |
| `WORKOS_API_KEY` | WorkOS server API | Secret server value; never exposed to the browser |
| `WORKOS_COOKIE_PASSWORD` | AuthKit session-cookie encryption | Random value at least 32 characters long |
| `NEXT_PUBLIC_WORKOS_REDIRECT_URI` | AuthKit callback URL | `http://localhost:3000/auth/callback` locally; exact deployed HTTPS callback in Railway |
| `STREETLIGHT_PILOT_WORKOS_ORGANIZATION_ID` | Maps the seeded founder church to WorkOS | Exact WorkOS organization ID for the founder church |

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

## WorkOS staging setup

In the WorkOS dashboard:

1. Keep public signup disabled and enable email/password only. Do not enable social login.
2. Add `http://localhost:3000/auth/callback` as the staging redirect URI.
3. Set `http://localhost:3000/login` as the sign-in endpoint.
4. Set `http://localhost:3000/` as the default logout URI.
5. Create one organization for each test church and invite its administrators through WorkOS.
6. Put the founder church's organization ID in
   `STREETLIGHT_PILOT_WORKOS_ORGANIZATION_ID`, then run `pnpm db:seed`.

The seed command loads `web/.env.local` and stores that organization ID on the founder church.
Other church and organization associations remain a Phase 8 onboarding task.

Production and recovery configuration belongs to Phase 10.
