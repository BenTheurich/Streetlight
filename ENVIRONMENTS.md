# Environment variables

The local SQLite database is generated at `web/data/streetlight.db`.

Store local values in the ignored `web/.env.local` file:

| Variable | Used for | Required restrictions |
|---|---|---|
| `GOOGLE_MAPS_BROWSER_API_KEY` | Interactive administrator map and church-address suggestions | Maps JavaScript API, Places API (New), and approved HTTP referrers only |
| `GOOGLE_MAPS_SERVER_API_KEY` | Server-side church-address geocoding and founder Map Lab satellite tiles | Geocoding and Map Tiles APIs plus server-origin restrictions; never exposed to the browser |
| `GOOGLE_MAPS_STATIC_API_KEY` | Legacy local fallback for server-side Google requests | Enable only the APIs still used locally, including Map Tiles for Map Lab satellite; never expose it to the browser |
| `STREETLIGHT_PYTHON` | Optional Overture importer executable | Set only when `python` is not the desired executable |
| `SSL_CERT_FILE` | Optional CA bundle for DuckDB HTTPS imports | Set only when the Python/OpenSSL installation has no usable certificate store |
| `WORKOS_CLIENT_ID` | WorkOS AuthKit application | Staging client ID for local work; production value only in Railway |
| `WORKOS_API_KEY` | WorkOS server API | Secret server value; never exposed to the browser |
| `WORKOS_COOKIE_PASSWORD` | AuthKit session-cookie encryption | Random value at least 32 characters long |
| `NEXT_PUBLIC_WORKOS_REDIRECT_URI` | AuthKit callback URL | `http://localhost:3000/auth/callback` locally; exact deployed HTTPS callback in Railway |
| `STREETLIGHT_PILOT_WORKOS_ORGANIZATION_ID` | Maps the seeded founder church to WorkOS | Exact WorkOS organization ID for the founder church |
| `STREETLIGHT_FOUNDER_EMAIL` | Founder-only pilot request review | Optional override; defaults to `bentheurich@gmail.com` |

The browser key is intentionally visible in the rendered map request and must be protected by
API and referrer restrictions. The server key and legacy Static Maps key must never use a
browser-visible `NEXT_PUBLIC_` name.

Without `GOOGLE_MAPS_BROWSER_API_KEY`, Territory Setup renders a clear unavailable-map state
while database, test, and production-build commands continue to work. Address changes require
one of the server-side keys; the existing saved address and location remain usable without it.
Church onboarding falls back to manual address entry without the browser key, but its Google
suggestions require Places API (New) to be enabled for that key's project.
Founder Map Lab satellite mode also requires Map Tiles API on one server-side key; it never sends
that key to the browser.

Install the pinned importer dependency with:

```powershell
python -m pip install -r web/importer/requirements.txt
```

Overture import requires network access to its public S3 data but no API key. Streetlight
explicitly uses anonymous access and does not reuse ambient AWS credentials.
On Windows, point `STREETLIGHT_PYTHON` at the prepared importer environment when the Microsoft Store
Python alias is unusable. If DuckDB reports a certificate verification error, point
`SSL_CERT_FILE` at a trusted local CA bundle such as Git for Windows' `ca-bundle.crt`.

## WorkOS staging setup

In the WorkOS dashboard:

1. Keep public signup disabled and enable email/password only. Do not enable social login.
2. Add `http://localhost:3000/auth/callback` as the staging redirect URI.
3. Set `http://localhost:3000/login` as the sign-in endpoint.
4. Set `http://localhost:3000/` as the default logout URI.
5. Put the founder church's organization ID in
   `STREETLIGHT_PILOT_WORKOS_ORGANIZATION_ID`, then run `pnpm db:seed`.

The seed command loads `web/.env.local` and stores that organization ID on the founder church.
The founder's Pilot requests page creates each approved church organization and first invitation.
That live action is intentionally not exercised by automated tests.

## Phase 8 founder browser check

This check sends one real WorkOS invitation and should be run only when the founder is ready:

1. In a signed-out browser, open `/` and submit one unique pilot request from the landing drawer.
2. Sign in as the configured founder, open **Pilot requests**, and confirm the request appears once.
3. Correct the church name or invitation email if needed, then choose **Approve and invite**.
4. Open the invitation in a separate browser profile and sign in as the invited administrator.
5. Confirm the church name, enter the full church address and time zone, and continue.
6. Verify Streetlight opens a one-mile circular Territory Setup with no imported streets.
7. Save Territory Setup once, then confirm Coverage, Generate packets, and Reconcile become
   available.

Production and recovery configuration belongs to Phase 10.
