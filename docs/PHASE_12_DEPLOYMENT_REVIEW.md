# Phase 12 deployment and recovery

September 6, 2026. Status: in progress. The target is
`https://streetlight.bentheurich.com`; deployment and public workflow verification remain pending.

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
`ea105bb`; the Phase 12 changes are still in the Windows working tree and must be committed and
pushed before updating this checkout. The Windows branch is based on `9ff56f9`, which also matched
fetched `origin/main` at the start of this deployment work.

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
| Complete import and PDF on gb-dev | Pending |
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
establish an importer memory requirement. The full import still needs measurement on `gb-dev`.

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
settings remain unchanged. Production key restriction metadata and a deployed authenticated
lookup still need verification.

The saved [Streetlight pilot - 5 USD monthly budget](https://console.cloud.google.com/billing/011F8B-071052-C508D8/budgets/76b75f9e-3912-4c14-9314-5e9352c85406/edit?project=streetlight-503712)
applies only to project Streetlight and includes all its services. It uses a calendar month,
a fixed $5 amount, and the default savings deductions. Its rules are actual spend at 50%, 90%,
and 100%, plus forecast spend at 100%. The linked Monitoring email channel is
`Ben - Streetlight budget alerts`, with recipient `bentheurich@gmail.com`. Billing-admin,
project-owner, and Pub/Sub notification options are off. The pre-existing account-wide budget
was left unchanged. This budget sends alerts only.

Cloudflare tunnel `streetlight-gb-dev` (`b879e43b-0891-4c47-a349-21bdc1d52f17`) was created;
its credential is stored on `gb-dev` with mode 600. Connection and the public DNS route remain
pending, along with WorkOS production configuration and production Google keys. No Railway
subscription or service was created. Ben approved starting with a fresh church workspace;
the existing local database will not be copied.

## Deployment sequence

1. Finish and verify the Compose configuration and Cloudflare request identity changes. Commit and
   push the Phase 12 branch, then update the clean `gb-dev` checkout to that exact revision.
2. Set the production values documented in
   [ENVIRONMENTS.md](../ENVIRONMENTS.md#phase-12-production-configuration). Configure WorkOS
   production for invite-only email/password, no public or social signup, callback
   `https://streetlight.bentheurich.com/auth/callback`, sign-in endpoint
   `https://streetlight.bentheurich.com/login`, and logout URL `https://streetlight.bentheurich.com/`.
   Apply the approved `web/branding/authkit.css` and branding assets. Keep staging credentials and
   organizations separate.
3. Create the Cloudflare Tunnel and route `streetlight.bentheurich.com` to `http://web:3000`.
   Store its token in the ignored secret file. From the repository root, validate with
   `docker compose config --quiet`, then run `docker compose up -d --build` and inspect
   `docker compose ps`. The services use persistent `/data` storage and automatic restart.
   Preserve the portfolio DNS records.
4. Create a fresh founder church workspace, as Ben approved. Do not copy the daily-driver database,
   seed demo data, or remap an existing organization. Real territory review and outreach remain
   Phase 13.
5. Verify the saved Google quotas and project budget. Restrict the browser key to
   `https://streetlight.bentheurich.com/*` and its documented Maps/Places APIs. Store the separate
   Geocoding server key in the ignored production environment file and record restriction
   metadata without key material.
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
