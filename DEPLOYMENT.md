# Streetlight operations

Start here for the live pilot. Phase 12 was approved on September 7, 2026. Provider setup and
verification history are in the [Phase 12 record](docs/PHASE_12_DEPLOYMENT_REVIEW.md).
Read [ENVIRONMENTS.md](ENVIRONMENTS.md#phase-12-production-configuration) before changing credentials
or provider settings. Agents need Ben's authorization for live changes; a documentation or status
request does not authorize a deployment.

| Item | Location |
|---|---|
| Public app | <https://streetlight.bentheurich.com> |
| Host and checkout | SSH through Tailscale with `ssh gb-dev`; `/home/ben/Projects/Streetlight` |
| Services | Root `compose.yaml`: `web` runs Next.js, the importer, and PDF rendering; `cloudflared` routes to `http://web:3000` |
| Database | Docker volume `streetlight_data`, mounted at `/data`; database `/data/streetlight.db` |
| Production secrets | Host checkout: ignored `deploy/.env.local` and `deploy/cloudflared-token`, mode 600; never print or commit their contents |

Keep `gb-dev` on AC power and online. The application has no published host port. Preserve the
private tunnel origin, the root and `www` portfolio DNS records, and other services on the host.

## Redeploy an application change

Test the change locally with `pnpm check`, commit it, and push it. GitHub CI runs on pull requests
to `main` and pushes to `main`; it does not deploy. Documentation-only changes need no image rebuild.

Connect with `ssh gb-dev`. Run these commands in Bash on that host, from the existing checkout:

```bash
cd /home/ben/Projects/Streetlight
git status --short --branch
git log -1 --oneline
docker compose ps
```

Confirm a clean checkout on the branch containing the tested fixes. The Phase 12 deployment used
`codex/phase-12-deployment-recovery`; do not assume `main` is deployed. If the branch or local changes
are unexpected, resolve that before pulling. Wait for imports and packet downloads to finish.
For a change with database migrations, take the manual snapshot below before proceeding.

Retain the running image, pull the branch's upstream, build, and replace only `web`:

```bash
streetlight_previous_image=$(docker inspect --format '{{.Image}}' "$(docker compose ps -q web)") &&
docker image tag "$streetlight_previous_image" streetlight:previous &&
git pull --ff-only &&
docker compose config --quiet &&
docker compose build web &&
docker compose up -d --no-deps --wait web &&
docker compose exec -T web \
  node ../scripts/smoke-production.mjs https://streetlight.bentheurich.com
```

Stop on any failure. The old app runs during the build; replacement briefly interrupts service.
Startup applies pending migrations without seeding and retains the database volume. Open the public
app afterward and verify sign-in and the changed workflow. The smoke command checks health only.
Record the deployed Git commit, image ID, and check results in the task handoff. Keep
`streetlight:previous` until the new deployment is accepted. Do not overwrite it by rerunning
the image-capture step after a failed deployment.

## Configuration changes

Edit runtime secrets only in the host's `deploy/.env.local`, retaining mode 600. Apply them with
`docker compose up -d --no-deps --force-recreate --wait web`, then run the public smoke command above.
`docker compose restart` does not load changed environment settings.

Changes to `NEXT_PUBLIC_WORKOS_REDIRECT_URI` require matching build and runtime values in
`compose.yaml`, matching WorkOS settings, and a rebuild. Normal application fixes require no new
Google keys, WorkOS organizations, invitations, or Cloudflare tunnel setup.

## Troubleshooting

```bash
docker compose ps
docker compose logs --tail=100 web
docker compose logs --tail=100 cloudflared
```

- If `web` is unhealthy, inspect its logs for startup, migration, storage, or configuration errors.
- If local health passes but the public URL fails, check the tunnel and host connectivity. Run the
  same smoke command with `http://127.0.0.1:3000` inside `web` to isolate local health.
- If sign-in returns to `0.0.0.0:3000`, check the public callback URL at build and runtime. The
  callback route must pass it as AuthKit's `baseURL`.

Logs may contain application details. Redact sensitive content before sharing. Use
`docker compose config --quiet` for validation; the unfiltered command can print resolved secrets.

## Manual snapshot and rollback

Create a consistent SQLite snapshot using the existing recovery tool, with a new filename each time:

```bash
docker compose exec -T web node db/recovery.mjs backup \
  /data/streetlight.db "/data/pre-deploy-$(date -u +%Y%m%dT%H%M%SZ).db"
```

The tool includes committed WAL data and checks integrity and foreign keys. Do not copy the running
database with plain `cp`. Never run `docker compose down -v`, prune its data volume, or seed production.

If the database schema and runtime configuration remain compatible with the previous application,
restore the image retained by the redeploy commands:

```bash
docker image tag streetlight:previous streetlight:pilot &&
docker compose up -d --no-deps --no-build --force-recreate --wait web &&
docker compose exec -T web \
  node ../scripts/smoke-production.mjs https://streetlight.bentheurich.com
```

Image rollback does not revert migrations, runtime settings, or the Git checkout. Record that the
running image differs from the checkout. If database recovery is needed, use the
[manual recovery procedure](docs/PHASE_12_DEPLOYMENT_REVIEW.md#manual-recovery-commands) to restore
into a new file. Confirm the exact files and obtain Ben's authorization before replacing live data;
retain the original. Restoring a snapshot loses changes made after it was taken.

## Pilot deferrals

Scheduled and off-machine backups remain deferred by Ben. A snapshot on `/data` does not protect
against losing `gb-dev`; configure backups and prove off-machine recovery before a real release.
The real support address is also deferred. Preserve the approved Google quotas, project budget
alerts, server-key restriction exception, and public-request limit documented in
[production configuration](ENVIRONMENTS.md#phase-12-production-configuration).
