# Pilot authentication and hosting design

Status: approved founder decision  
Approved: 2026-07-29

## Goal

Run Streetlight for the founder church and up to two additional pilot churches with the smallest
system the founder can personally operate, while retaining a clear path to a larger service.

## Architecture

Streetlight uses three providers during the pilot:

1. Railway hosts one container containing the Next.js application and Python/DuckDB Overture
   importer. A persistent Railway volume stores SQLite, and Railway volume backups protect it.
2. WorkOS AuthKit owns passwords, email verification, sessions, invitation emails, and church
   organizations.
3. Google Maps supplies interactive maps, geocoding, road snapping, and printable static maps.

No other infrastructure provider is required. The public application uses Railway's generated
HTTPS domain until the founder approves purchasing a custom domain.

## Authentication and isolation

- Authentication is invite-only email and password. There is no Google or other social login and
  no public account creation.
- Each WorkOS organization represents one church.
- Every authenticated server request derives the WorkOS organization from the validated session
  and resolves it to one Streetlight church. A browser-supplied church identifier never grants
  access.
- All version-one administrators in a church have the same permissions.
- The founder manually creates the first organizations and sends invitations from WorkOS.

## Pilot-access requests

The public landing page's **Request pilot access** form records a request; it does not create an
account. The founder reviews the request, creates or selects the church organization, and sends a
WorkOS invitation when approved. Building automated approval, sales tooling, or public signup is
outside the pilot.

## Data and imports

- Keep the existing SQLite database because the pilot's low write concurrency does not justify a
  database migration.
- Store SQLite on one persistent Railway volume and run one application replica.
- Keep Python and DuckDB for the Overture Parquet import. An import should return a job status to
  the website instead of relying on one long HTTP response, but it remains in the same deployment.
- Generated PDFs are reproducible downloads and do not require permanent object storage.

## Deployment and recovery

- Deploy one Railway Hobby service from the repository.
- Enable sleeping if the application becomes idle reliably.
- Configure a hard Railway spending limit and Google Maps API quotas.
- Enable Railway volume backups and demonstrate a restore into a separate copy before the pilot.
- Use the Railway HTTPS domain for the founder-church test. A custom domain is optional after that
  test succeeds.

Expected pilot cost is about $5 per month for Railway, with possible small usage overage during
imports. WorkOS authentication and normal pilot-scale Google Maps usage should remain within their
free allowances.

## Upgrade triggers

Move SQLite to PostgreSQL only after one of these occurs:

- More than one application replica is needed.
- Database locking or importer interference is measured.
- The database approaches the Railway Hobby volume limit.
- Stronger availability or recovery is required.
- Streetlight grows beyond roughly 10-20 active churches.

Split the importer into a Railway worker only when imports measurably interfere with the web
application. These are upgrades to the same product, not pilot prerequisites.

## Explicit exclusions

- No public signup or social login.
- No custom WorkOS domain during the pilot.
- No Supabase, R2, Resend, Redis, separate worker provider, or separate database service.
- No multi-region deployment, Kubernetes, autoscaling platform, or payment system.
- No custom domain purchase before the founder church approves the hosted pilot.
