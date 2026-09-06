# Environment variables

The local SQLite database is generated at `web/data/streetlight.db`.

Store local values in the ignored `web/.env.local` file:

| Variable | Used for | Required restrictions |
|---|---|---|
| `GOOGLE_MAPS_BROWSER_API_KEY` | Labeled hybrid Satellite view and church-address suggestions | Maps JavaScript API, Places API (New), and approved HTTP referrers only |
| `GOOGLE_MAPS_SERVER_API_KEY` | Server-side church-address geocoding | Geocoding API plus server-origin restrictions; never exposed to the browser |
| `STREETLIGHT_PYTHON` | Optional Overture importer executable | Set only when `python` is not the desired executable |
| `SSL_CERT_FILE` | Optional CA bundle for DuckDB HTTPS imports | Set only when the Python/OpenSSL installation has no usable certificate store |
| `WORKOS_CLIENT_ID` | WorkOS AuthKit application | Staging client ID for local work; production value only in Railway |
| `WORKOS_API_KEY` | WorkOS server API | Secret server value; never exposed to the browser |
| `WORKOS_COOKIE_PASSWORD` | AuthKit session-cookie encryption | Random value at least 32 characters long |
| `NEXT_PUBLIC_WORKOS_REDIRECT_URI` | AuthKit callback URL | `http://localhost:3000/auth/callback` locally; exact deployed HTTPS callback in Railway |
| `STREETLIGHT_PILOT_WORKOS_ORGANIZATION_ID` | Maps the seeded founder church to WorkOS | Exact WorkOS organization ID for the founder church |
| `STREETLIGHT_FOUNDER_EMAIL` | Founder-only pilot request review | Optional override; defaults to `bentheurich@gmail.com` |

The browser key is intentionally visible in the rendered map request and must be protected by
API and referrer restrictions. The server key must never use a browser-visible `NEXT_PUBLIC_`
name.

The ordinary Map view uses MapLibre and works without `GOOGLE_MAPS_BROWSER_API_KEY`. Satellite
and address suggestions require that browser key. Address changes require
`GOOGLE_MAPS_SERVER_API_KEY`; the existing saved address and location remain usable without it.
Church onboarding falls back to manual address entry without the browser key, but its Google
suggestions require Places API (New) to be enabled for that key's project.

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

The application reads these values from the environment loaded by Next.js. The repository-root
`.env.local` is not an application configuration source; use `web/.env.local` for local values.

## Phase 11 account review

Church account uses the same WorkOS staging organization as the administrator workspace. Every
authenticated request checks that the user still has an active membership in its organization.
Removing an administrator therefore denies their next request even if their session token has not
expired. If WorkOS cannot verify membership, the request is denied.

Migration `029_church_access.sql` adds the church access label. The established founder seed church
receives `founding`; other churches default to `standard`. A founder may assign `sponsored` to an
explicitly selected church through a database maintenance action. Account has no label-editing
endpoint. Changing a label does not grant membership or alter workflow permissions.

The September 6 account preview on port 4201 uses copied demo geography and simulated WorkOS
accounts. Its invitations send no email. The canonical local database has not received this
migration as part of the review setup.

Ben separately authorized a real browser check using 10 Minute Mail and disposable credentials.
It ran on port 3000 from `tmp/phase11-workos-staging-20260906` with a fresh migrated and seeded
database and a separate WorkOS staging organization. Email delivery, hosted invitation acceptance,
revocation, and removal passed. The removed administrator's existing session received 404 from
Account and 403 from the administrator and Coverage APIs. Both test users and the disposable
organization were deleted afterward, and their absence was verified. Ben's password, canonical
database, and original founder membership were unchanged. Automated regression tests continue
to use fake providers and must not send invitations or create WorkOS organizations.

The support email remains `support@streetlight.example` until Ben selects a real destination.
See [Phase 11 account review](docs/PHASE_11_ACCOUNT_REVIEW.md) for the recorded checks and preview links.

Production and recovery configuration belongs to Phase 12. Its deployment gate includes the
approved Google quotas, server-key restrictions, public-request rate control, and restore proof.
