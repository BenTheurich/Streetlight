# Phase 12 deployment and recovery

September 6, 2026. Status: in progress. The app is running privately on `gb-dev`.
Publishing `https://streetlight.bentheurich.com` and the public workflow checks are waiting on
WorkOS production activation, which Ben deferred until he adds billing information.

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
The host built `streetlight:pilot` successfully from that revision. Its image manifest list is
`sha256:6a2f92b1e4b68dc99a422e15996d5474fbe6c15ae1f3ca0ff75ae05d6355345e`.

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
`streetlight_data`. Its church, territory, street-segment, packet, and pilot-request tables are
empty. The fresh founder workspace will be provisioned after WorkOS activation. The environment
file contains the two production Google keys and a generated cookie secret; production WorkOS
keys are absent. No staging credentials or existing workspace data were copied.

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
| Cloudflare connector | Healthy, one replica, version 2026.8.3; QUIC connections established; no public routes |
| Production Google key restrictions | Saved and verified: browser hostname plus Maps JavaScript / Places API (New); separate server key allows only Geocoding |
| Complete import and PDF on gb-dev | Passed with production CPU availability and a 4 GiB test memory cap: import 659.8 seconds; three-packet PDF 3.87 seconds; peak 1.69 GiB, no OOM |
| Imported-data persistence | Passed: 1,133 segments, 3,736 assigned addresses, 4,528 buildings; three finalized packets totaling 95 homes; integrity, foreign keys, and post-run health passed |
| Host PDF inspection | Passed: three US Letter pages, 1,989,624 bytes; first-page map, labels, QR code, and footer render without clipping |
| Deployed health, authentication, and core browser workflow | Pending |
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
The production app, tunnel, and empty production database remain on `gb-dev`.

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
settings remain unchanged. A deployed authenticated lookup and its request-metrics evidence
remain pending until WorkOS production is configured.

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
and no routes. No DNS records were changed, and no Railway subscription or service was created.

WorkOS blocks production access until billing information is added. Its
[environment documentation](https://workos.com/docs/authkit/environments) confirms that ordinary
email/password AuthKit is free below one million monthly active users but still requires billing
information to unlock production. Ben explicitly deferred that account step. Production keys,
redirects, invite-only settings, branding, and founder membership therefore remain pending.
Do not enable paid custom domains or enterprise connections. The public tunnel route remains
absent until production authentication is ready.

## Deployment sequence

1. The implementation is deployed privately at `05adc70`. Before resuming, confirm the current
   checkout, `docker compose ps`, and the healthy tunnel. Do not recreate the tunnel or Google keys.
2. Set the production values documented in
   [ENVIRONMENTS.md](../ENVIRONMENTS.md#phase-12-production-configuration). Configure WorkOS
   production for invite-only email/password, no public or social signup, callback
   `https://streetlight.bentheurich.com/auth/callback`, sign-in endpoint
   `https://streetlight.bentheurich.com/login`, and logout URL `https://streetlight.bentheurich.com/`.
   Apply the approved `web/branding/authkit.css` and branding assets. Keep staging credentials and
   organizations separate.
3. After WorkOS is configured, add a public route to the existing Cloudflare Tunnel from
   `streetlight.bentheurich.com` to `http://web:3000`. From the repository root, validate with
   `docker compose config --quiet`, then run `docker compose up -d` to load the completed
   production environment and inspect `docker compose ps`. Rebuild if the source or public callback
   changes. Preserve the portfolio DNS records.
4. Create a fresh founder church workspace, as Ben approved. Do not copy the daily-driver database,
   seed demo data, or remap an existing organization. Real territory review and outreach remain
   Phase 13.
5. The Google keys, quotas, and project budget are configured. Verify that the same recorded
   controls are still effective when resuming; keep key values out of command output and evidence.
6. Measure a complete import and PDF generation on `gb-dev`. Check the application after a
   container restart and run `pnpm smoke:production https://streetlight.bentheurich.com`.
7. Confirm unauthenticated and malformed authenticated geocodes do not reach Google. Perform one
   valid authenticated lookup through the public app and confirm it in Geocoding metrics. Never
   exhaust the production quota for a test.
8. In a reserved test window, submit the same valid public request six times from one IP. The
   first five responses must remain neutral and the sixth must return `429` with `Retry-After`.
   Vary spoofed `X-Real-IP`, `X-Forwarded-For`, and `CF-Connecting-IP` values to prove the public
   edge preserves the real client identity. Confirm the application port is not exposed on the
   host.
9. Run the deployed browser workflow: sign in, review test territory, generate, finalize,
   download and inspect the PDF, reconcile, inspect Coverage and Outreach Progress, then sign
   out. Record results and give Ben the founder review steps.

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

Phase 12 is not ready for final approval. After the deployed workflow, health, restart, and public
rate-limit checks pass, Ben will sign in to `https://streetlight.bentheurich.com`, create a test
batch, download its PDF, and approve or reject the pilot URL. The tested manual recovery commands
remain in scope; scheduled backups and an off-machine restore demonstration are deferred under
his pilot exception. Phase 13 remains pending until Ben approves Phase 12.

The immediate next step is Ben adding WorkOS billing information. Public sign-in, initial founder
provisioning, browser workflow, Google request metrics, and public rate-limit verification wait
for that step.
