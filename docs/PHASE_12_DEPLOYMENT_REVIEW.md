# Phase 12 deployment and recovery

September 7, 2026. Status: complete, approved by Ben. The app is public at
`https://streetlight.bentheurich.com`, served by `gb-dev` through Cloudflare Tunnel.
WorkOS production is active, Ben accepted the first invitation, and church-address geocoding
passed. The first import, packet PDF, reconciliation, Coverage, and Outreach Progress checks pass.
Test cleanup, the public rate limit, persistence after restart, fresh sign-in, and the live
malformed-geocode check also pass. Ben approved Phase 12 and the pilot URL on September 7, 2026.

Phase 11 is complete in `main`, including Ben's review and the real WorkOS staging checks.
Phase 12 started on `codex/phase-12-deployment-recovery`, based on `9ff56f9`. Phase 13 has not started.
Ben approved replacing the unshipped Railway deployment with `gb-dev` and Cloudflare Tunnel.
He separately deferred scheduled and off-machine backups for this pilot. Configure backups and
prove recovery from an off-machine copy before a real release.

## Deployment target

The read-only preflight on `gb-dev` found CachyOS x86_64, an Intel i7-1165G7 with 4 cores and
8 threads, about 16 GB RAM with 8.7 GB available, and 424 GB free disk. Docker 29.7.2 and
Compose 5.5.0 work. Docker and Tailscale start at boot; `cloudflared` was not installed.
The machine uses Wi-Fi. Automatic suspend is disabled on external power, including lid closure;
battery operation still permits suspend. Keep the laptop on AC power for the pilot.

The existing checkout is `/home/ben/Projects/Streetlight`. Preflight found a clean `main` at
`ea105bb`. The verified implementation was committed and pushed as `05adc70` on
`codex/phase-12-deployment-recovery`, based on `9ff56f9`, then fetched and checked out on `gb-dev`.
The current image includes `11f3bf8`, which fixes Docker's authentication return origin, and
`17f32ec`, which exposes the first region Save button before any draft edit. The host built and
deployed `streetlight:pilot` from `17f32ec`. Its image manifest list is
`sha256:c5d6cf67aac655cfa3f29c83371580eabb555291c01586d1c32711f6d869d6d2`.

The deployment configuration uses root `compose.yaml`, the existing Dockerfile, and two services:

- The application runs Next.js, the Python/DuckDB Overture importer, and Chromium PDF rendering.
  SQLite lives on a persistent volume mounted at `/data`.
- `cloudflared` reaches `http://web:3000` on a private Docker network and publishes
  `streetlight.bentheurich.com`. The application has no published host port. Tailscale remains
  the private SSH connection.

Add only the Streetlight subdomain route. Preserve the root and `www` records serving Ben's
GitHub Pages portfolio. Production variables belong in ignored `deploy/.env.local`; the tunnel
credential belongs in ignored `deploy/cloudflared-token`. Only the public WorkOS callback URL
is an image build argument. The Docker context excludes secrets, databases, host dependencies,
and local build output.

Startup validates the `/data` mount, resolves the database path inside it, and requires
`STREETLIGHT_TRUST_CLOUDFLARE=1`. It migrates the database before starting Next.js and does not
seed or replace church data. `STREETLIGHT_DATABASE_PATH` controls both migrations and queries.
Shell scripts retain LF line endings in Git.

Both Compose services are running with `unless-stopped` restart policies. The app is healthy
before and after a container restart, and runs as UID 1000 with a UID-1000 database on
`streetlight_data`. A fresh founding-access church named `Test church 1` is linked to production
WorkOS organization `org_01M1WC3YPD0KAT892XZQP33V9P`. Ben accepted its administrator invitation,
then supplied a Temecula church address for the deployment check. Onboarding saved
`America/Los_Angeles` and created the one-mile draft. The environment file contains the separate
production Google and WorkOS credentials and generated cookie secret, with mode 600.
No staging credentials or existing workspace data were copied.

The public form uses validated `CF-Connecting-IP` with Ben's approved five attempts per IP per
fixed UTC hour. It ignores `X-Real-IP` and `X-Forwarded-For`, canonicalizes IPv6, stores only a hash
and window counter in SQLite, and removes expired counters. Invalid, honeypot, and duplicate
attempts count. Attempt six returns `429` with the remaining window seconds in `Retry-After`.
Missing or malformed trusted identity returns `503`. Local previews leave Cloudflare trust unset
and ignore forwarding headers. Public verification must establish that client-supplied headers
cannot bypass this limit.

`/api/health` performs a read-only query against the migrated database. Missing or unusable storage
returns `503` without creating a database. Health bypasses AuthKit and returns no church data.
`pnpm smoke:production <HTTPS-origin>` checks that endpoint; explicit localhost HTTP is accepted
for isolated verification.

## Verification evidence

The final Cloudflare configuration passed a production image build, TypeScript, all 487 tests,
and Biome. Earlier recovery and browser evidence is identified separately below.

| Verification | Result |
|---|---|
| Canonical `pnpm check` in an isolated source copy | Passed |
| Application tests | 410 passed in the final production image with isolated test settings |
| Python launcher tests | 4 passed |
| Importer tests | 73 passed |
| Biome | 210 files, passed |
| TypeScript and production build | Passed |
| Fresh migrations and seed | Passed in the isolated directory |
| Health smoke against isolated production server | Passed on port 4202 |
| Manual backup and restore CLI | Passed; restored 1 church and 55 street segments |
| Recovery regression checks | Preserved committed WAL data, packet history, corrections, and append-only triggers; rejected existing targets and invalid databases |
| Prior public-form browser check | Passed at 390px with simulated Railway headers; five successes, sixth `429`, retained draft, no overflow or JavaScript exceptions |
| Linux container build | Passed after Docker restarted; Node.js 24.15 and Next.js production build |
| Container import at 512 MiB | One-mile Temecula import exited 137 with an OOM kill while downloading buildings |
| Container PDF at 512 MiB | Three-packet render failed with two OOM kills |
| Container PDF at 1 GiB | Passed in 6.6 seconds, about 693 MiB peak, no OOM kills |
| Google Geocoding v3 quota overrides | Saved and verified: 25/day and 5/minute in `streetlight-503712` |
| Unused Geocoding v4 methods | All four effective daily overrides saved and verified at zero |
| Google project budget | Saved: Streetlight only, $5/month, approved actual and forecast thresholds, Ben's email |
| Compose and startup guards | Passed: valid Compose; startup rejects missing volume, database paths outside `/data`, and missing Cloudflare trust |
| Cloudflare identity and restart checks | Passed locally: five neutral successes, sixth `429`, spoofed forwarding headers ignored, missing identity `503`; database and counter survive restart |
| Restricted non-root container PDF | Three-packet open-map PDF passed in 2.523 seconds, 1,744,007 bytes; runtime UID and database owner are 1000 |
| gb-dev build, storage, and restart | Passed at `05adc70`; fresh migrated database, UID 1000 ownership, health before and after restart, no host port bindings |
| Cloudflare connector | Healthy, one replica, version 2026.8.3; public Streetlight hostname routes to `http://web:3000` |
| Production Google key restrictions | Saved and verified: browser hostname plus Maps JavaScript / Places API (New); separate server key allows only Geocoding |
| Complete import and PDF on gb-dev | Passed with production CPU availability and a 4 GiB test memory cap: import 659.8 seconds; three-packet PDF 3.87 seconds; peak 1.69 GiB, no OOM |
| Imported-data persistence | Passed: 1,133 segments, 3,736 assigned addresses, 4,528 buildings; three finalized packets totaling 95 homes; integrity, foreign keys, and post-run health passed |
| Host PDF inspection | Passed: three US Letter pages, 1,989,624 bytes; first-page map, labels, QR code, and footer render without clipping |
| Public health and origin isolation | Passed after deployment at `17f32ec`; HTTPS health succeeds, web has no published host port, portfolio DNS unchanged |
| Production WorkOS setup | Verified production client, callback/login/logout URLs, invite-only password authentication, copied branding, founder organization and active membership |
| First invitation and onboarding | Ben accepted the invitation and set his password; production Places suggestions and authenticated Geocoding succeeded |
| Container callback redirect | Passed after fix: WorkOS records a fresh production sign-in at `2026-09-07T00:21:55.898Z`; the signed-in public Streetlight map loads; TypeScript, lint, 7 focused authentication checks, and production build also passed |
| Initial region save | Reproduced missing Save on untouched draft; three render conditions fixed; 20 focused region checks, TypeScript, lint, and build passed; live Save starts the import |
| Google request metrics | Production server-key filter shows 1 Geocoding request, no listed errors, average latency 89 ms |
| Geocoding rejection | Passed: public unauthenticated POST returned `401`; Ben's signed-in browser POST with `{}` returned `400` and `Enter a church address`; route tests verify both rejection paths make zero Google calls |
| Public forwarding-header spoof | Forged `CF-Connecting-IP` requests rejected by Cloudflare with `403` / error 1000 before reaching the application |
| Public request attempt-six limit | Passed with Ben's approved synthetic request: five `200` responses, then `429` and `Retry-After: 3510`; varying `X-Real-IP` and `X-Forwarded-For` did not reset the limit |
| Deployed import | Passed in 653 seconds; 1,133 imported segments and 2,611 eligible estimated homes; onboarding unlocked after success |
| Deployed packet and reconciliation workflow | Passed: labeled test batch with 3 packets and 95 estimated tracts; 3-page PDF downloaded and visually inspected; one test completion and two cancellations saved; Coverage and Outreach Progress both show the 28-home completion |
| Test cleanup | Passed: completion undone, all three packets cancelled, no active reservations; Outreach Progress returns to zero and Coverage shows all 2,611 estimated homes as never covered |
| Production database integrity and restart | Passed after cleanup and app restart; 1 church, 1,133 segments, 3 cancelled packets, one declined test request, saved rate counter of 5; integrity `ok`, no foreign-key errors |
| Production sign-out | Passed: WorkOS logout returns to Streetlight's public homepage |
| Scheduled and off-machine backups | Deferred by Ben for the pilot; required before real release |

The isolated source copy is `tmp/phase12-verification-20260906`. Test dependencies and synthetic
credentials stay in ignored temporary directories. Earlier check evidence is in
`output/playwright/phase12/canonical-check.log`, `browser-results.json`, and `rate-limit-mobile.png`.
The prior browser check does not establish Cloudflare's deployed header behavior.
Final image, test, startup, HTTP, and PDF evidence is in
`output/playwright/phase12/selfhost/`. Compose publishes no application host port.

The container measurements are recorded in `output/playwright/phase12/free-fit/results.json`.
The current application does not fit a 512 MiB container. The successful 1 GiB PDF run used the
web server and renderer in the same Node process and real open-map rendering; it does not
establish an importer memory requirement.

The full one-mile Temecula import on `gb-dev` completed in 659.8 seconds with the production
default of eight DuckDB threads. It used a separate synthetic database, no production credentials,
and a 4 GiB/no-swap test memory cap. The production Next.js server remained active in the test
container. Import, persistence, finalization of three packets, and their PDF used a peak of
1.69 GiB without an OOM event. This verifies the tested workload on the laptop, not every radius
or concurrent workload. The imported region reported 84.4% address matching and quality warnings;
geographic review remains separate from deployment verification.

An earlier diagnostic limited the container to two CPUs and timed out after 900.5 seconds in
`downloading_streets`, with a 731 MiB peak and no OOM. In-memory settings checks showed that the
quota reduced DuckDB's default thread count from eight to two. DuckDB uses each thread for at
most one remote HTTP request at a time, as documented in its
[workload tuning guide](https://duckdb.org/docs/current/guides/performance/how_to_tune_workloads).
The successful retry removed that diagnostic CPU quota and retained the memory cap. No importer
code or timeout was changed.

Host benchmark evidence is saved in `output/playwright/phase12/selfhost/import-summary.json`,
`import-state.json`, `import-packets.pdf`, `import-pdfinfo.txt`, and `import-packets-page1.png`.
The constrained attempt is recorded separately in `import-2cpu-*`. The temporary benchmark
container, volume, and remote directory were removed after copying the evidence. The local
credential-transfer helper and earlier Windows verification container and volume were also removed.
The production app, tunnel, and separate pilot database remain on `gb-dev`.

The subsequent public browser check used the founder-approved address in `Test church 1`.
Import job `ce065ad3-e445-4557-b215-79248a2bbff2` ran from 22:36:42 to 22:47:35 UTC on
September 6, or September 7 in Ben's local time. It completed in 653 seconds and unlocked
onboarding. The public workflow produced batch `Deployment check 2026-09-07`, with packets
of 28, 37, and 30 estimated tracts. Its downloaded PDF is 1,989,596 bytes and three US Letter
pages. All pages were rendered and inspected for map highlights, labels, starting addresses,
QR codes, footers, and clipping. PDF and page images are in
`output/playwright/phase12/selfhost/public-packets-20260907*`; compact evidence is in
`public-workflow-20260907.json` in that directory.

The reconciliation check recorded the first test packet as completed on the church's September 6
date and cancelled the other two. Coverage showed 28 green estimated homes and 2,583 red;
Outreach Progress showed one completed packet, three streets, and 28 estimated homes reached.
Ben accepted the Undo completion confirmation. The restored packet was then discarded through
reconciliation. All three test packets are cancelled, no reservations remain, and Outreach
Progress shows zero completed packets, streets, and homes. Coverage shows all 2,611 estimated
homes as never covered. The labelled batch and correction history remain for audit.

Ben separately approved the synthetic public request using `pilot-verification@streetlight.example`.
Six submissions produced five neutral `200` responses followed by `429` with `Retry-After: 3510`.
Each submission varied `X-Real-IP` and `X-Forwarded-For`. Only one request was created, then
declined through the founder page; its church, organization, and invitation references remain
null. No invitation or email was sent. The web container was restarted after cleanup. Public
health, data integrity, and the saved limiter count of five passed afterward. Evidence is in
`public-rate-limit-20260907.json` and `public-cleanup-20260907.json` in the same evidence directory.

Ben completed a fresh production sign-in after the callback fix. WorkOS records it at
`2026-09-07T00:21:55.898Z`, with active membership in `Test church 1`. The browser displays the
authenticated map at the public Streetlight origin. Ben then sent an empty JSON object to
`/api/geocode` from that signed-in page. His supplied console screenshot shows HTTP `400`
and `{error: 'Enter a church address'}`. The screenshot is retained as
`malformed-authenticated-geocode-20260907.png` in the evidence directory. The existing route
regression test verifies rejection occurs before a Google call; the successful onboarding
lookup and provider request metric are recorded separately above.

## Approved provider controls

Ben approved these controls on September 6:

- Keep the Geocoding key server-only and restricted to the Geocoding API. The approved IP
  application restriction exception carries forward to `gb-dev`'s dynamic home egress.
  Cloudflare Tunnel does not give Google requests a static outbound IP. A leaked key could
  consume the allowed quota.
- Set project Geocoding v3 quotas to 25 requests per day and 5 per minute. Set daily quotas
  for the four unused v4 methods to zero.
- Set a $5 monthly Streetlight Google Cloud project budget, with actual-spend alerts at 50%,
  90%, and 100%, and a forecast alert at 100%, sent to `bentheurich@gmail.com`. Billing budgets
  send alerts; API quotas enforce request limits.
- Defer the real support address while Ben sets it up. The placeholder remains a release follow-up.

The existing Google Cloud project is `streetlight-503712`, number `718773459419`.
Its Geocoding v3 quota rows show effective overrides of 25 requests/day and 5 requests/minute.
These project quotas also apply to local lookups using this project. No requests were sent to
exhaust or test provider limits. The unused v4 GeocodeAddress, GeocodeLocation, GeocodePlace,
and SearchDestinations methods each have an effective daily override of zero. Their per-minute
settings remain unchanged. A deployed authenticated onboarding lookup succeeded on September 7.
Metrics filtered to `Streetlight pilot geocoding server` show one Geocoding API request, no listed
errors, 89 ms average latency, and 130 ms 99th-percentile latency. Provider quotas were not exhausted.

Two separate production keys were created and their saved metadata verified:

- `Streetlight pilot browser`, ID `ca12c793-5281-428e-98fc-1b868dc7a2c0`, permits only Maps
  JavaScript API and Places API (New), with the sole HTTP referrer
  `https://streetlight.bentheurich.com/*`.
- `Streetlight pilot geocoding server`, ID `5f5c5c29-862a-470d-82d5-6ef9645b8ff5`, permits only
  Geocoding API. Its application restriction is None under Ben's dynamic-egress exception.

Both values are in `gb-dev`'s ignored `deploy/.env.local`, owned by `ben` with mode 600.
The existing development key was left unchanged. No Google request was sent during key setup.

The saved [Streetlight pilot - 5 USD monthly budget](https://console.cloud.google.com/billing/011F8B-071052-C508D8/budgets/76b75f9e-3912-4c14-9314-5e9352c85406/edit?project=streetlight-503712)
applies only to project Streetlight and includes all its services. It uses a calendar month,
a fixed $5 amount, and the default savings deductions. Its rules are actual spend at 50%, 90%,
and 100%, plus forecast spend at 100%. The linked Monitoring email channel is
`Ben - Streetlight budget alerts`, with recipient `bentheurich@gmail.com`. Billing-admin,
project-owner, and Pub/Sub notification options are off. The pre-existing account-wide budget
was left unchanged. This budget sends alerts only.

Cloudflare tunnel `streetlight-gb-dev` (`b879e43b-0891-4c47-a349-21bdc1d52f17`) is healthy;
its credential is stored on `gb-dev` with mode 600. Cloudflare confirms one connected replica
and the Streetlight route to `http://web:3000`. The new `streetlight` CNAME points to
`b879e43b-0891-4c47-a349-21bdc1d52f17.cfargotunnel.com`. The root GitHub Pages A records and
`www` CNAME to `bentheurich.github.io` remain unchanged. No Railway service was created.

Ben activated WorkOS production. The WorkOS MCP now provides authenticated configuration and
membership access. Production environment `environment_01KYQK0EHFTJPTCB74METBJHRR` uses client
`client_01KYQK0ER1P5TCH17DH9CR7HX9` and AuthKit domain `quick-canyon-55.authkit.app`.
Public signup, social login, SSO, magic links, and passkeys are disabled; password authentication
and the existing email-verification requirement are enabled. Callback, login, and logout use
the Streetlight public hostname. The approved staging branding was copied and compared against
production. No paid custom domain or enterprise connection was enabled.

The active runtime API key is `Streetlight production runtime`, ID
`key_01M1WCA8KAHKEDG2SR2ZZFA3F4`. Two unused setup keys were immediately expired after their
values appeared in tool output; expiration and absence of use were verified. Neither is the
running container's credential. Key values do not belong in this document or Git.

## Resuming deployment verification

The production credentials, tunnel route, and founder workspace exist. Do not provision them
again. Confirm the current branch and `docker compose ps` on `gb-dev` before a deployment.
Validate with `docker compose config --quiet`; use `docker compose build web` for source changes
and `docker compose up -d web` to load the image or runtime environment. Avoid restarting during
an import. Run `pnpm smoke:production https://streetlight.bentheurich.com` afterward.

Phase 12 is complete. Keep `Test church 1` available for further testing.
Do not rerun provisioning, imports, or the public request test merely to resume the task.
The saved cancelled test batch and declined synthetic request are verification history.

## Manual recovery commands

These commands remain available; Ben has requested no scheduled or off-machine backup setup
for the pilot. Data exists only on `gb-dev`, so loss of its storage can lose the pilot database.
Before a real release, configure backups and demonstrate recovery from an off-machine copy.

Each command requires explicit paths and a destination that does not exist. Its parent directory
must already exist. The commands use SQLite's online-backup API, validate integrity and foreign
keys, and publish a complete file without overwriting. They print table counts for comparison.

```sh
pnpm db:backup /data/streetlight.db /data/pre-review-backup.db
pnpm db:restore /data/pre-review-backup.db /data/restore-review.db
```

Inside the container, the equivalent commands from `/app/web` are:

```sh
node db/recovery.mjs backup /data/streetlight.db /data/pre-review-backup.db
node db/recovery.mjs restore /data/pre-review-backup.db /data/restore-review.db
```

Use a new destination for each operation. A copy on the same volume does not protect against
loss of that volume. These commands do not switch the running application to a recovered file.
Confirm the exact current and recovered files before a cutover, and retain the original database
until the founder has inspected the recovered church, packet, and coverage records.

## Founder checkpoint

Ben explicitly approved Phase 12 on September 7, 2026, accepting
`https://streetlight.bentheurich.com` as the pilot URL. This closes the human-review checkpoint.
Phase 13 remains pending, with its Phase 12 dependency satisfied.

The tested manual recovery commands remain available. Scheduled backups and an off-machine
restore demonstration are deferred under Ben's pilot exception. The real support address is
also deferred.
