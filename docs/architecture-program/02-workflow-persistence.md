# Task 02: Organize persistence by product workflow

## Objective

Replace the broad `database.ts` interface with deep persistence modules organized around current Streetlight workflows while preserving SQLite, transaction atomicity, church isolation, and outward product behavior.

Account for the public pilot-request abuse risk at the persistence and deployment seam without inventing an unapproved policy threshold.

## Program position

- Branch: `codex/arch-02-persistence-modules`
- PR base: `codex/architecture-review`
- Depends on: Task 01 merged
- Required next task: Task 03

Follow `ORCHESTRATION.md` for the complete task cycle.

## Required context

Read:

- `PRODUCT.md`, especially church ownership, coverage history, packet lifecycle, reconciliation, and approved pilot architecture.
- `IMPLEMENTATION_PLAN.md`, especially database, authentication, and deployment phases.
- `web/lib/database.ts` and `web/db/database.test.mjs`.
- Every production import of `@/lib/database` and relative `database.ts` paths.
- `web/lib/workspace-scope.ts`, `auth.ts`, and `authenticated-route.ts`.
- `web/lib/pilot-requests.ts` and both pilot-request routes.
- All SQLite migrations.

## Observed pressure

At the reviewed commit, `database.ts` contains 2,765 lines and 37 exported declarations. Twenty-two production files consume the module. It owns outward read-model types and SQLite implementation for authentication lookup, settings, coverage, maps, packet generation, finalization, downloads, reconciliation, corrections, territory saves, imports, and apartments.

Many operations are deep and transactionally correct. The problem is ownership and locality, not the use of SQL or the absence of generic repositories.

The public pilot-request route validates exact keys, limits field lengths, uses a honeypot, and returns duplicate-neutral success. It has no request-rate control. Any control that trusts an IP header or introduces a numeric policy needs a named deployment mechanism and testable source of truth.

## Scope

### Domain type ownership

Move outward product vocabulary out of the raw SQLite implementation. Callers should import coverage, region, batch, reconciliation, map, settings, and organization concepts from the module that owns each workflow.

Keep names aligned with `PRODUCT.md`. Do not invent generic entity, repository, manager, or data-access vocabulary.

### Workflow persistence modules

Select workflow seams that hide complete reads, writes, invariants, and transactions. Expected current workflows include:

- Organization access and initial setup.
- Coverage and heatmap settings.
- Batch proposal inputs, finalization, and downloads.
- Reconciliation, corrections, and undo.
- Region reads and atomic region replacement.
- Printout settings.
- Open-map read data.

The selected design may combine workflows when one transaction or invariant makes separation shallow. The selected design may also leave a cohesive private SQLite implementation shared internally. Callers must not learn raw database handles, row shapes, table order, or transaction ordering.

### Replace rather than wrap

Move callers to the new interfaces and remove superseded exports from `database.ts`. Thin files that re-export the old functions fail the deletion test. Per-table repositories also fail because current behavior is organized around product transactions, not tables.

Delete or rewrite old tests once equivalent behavior is proven through the new workflow interfaces. Keep migration and low-level database tests that protect schema invariants or transaction rollback.

### Public pilot-request abuse control

Decide where the rate-control seam belongs for the approved one-container Railway pilot.

An application change is acceptable only when it has:

- A trustworthy request identity.
- A founder-approved or provider-derived threshold.
- Deterministic tests.
- No unbounded in-memory state.
- No new infrastructure provider.

If those inputs do not exist before Phase 12, update the Phase 12 deployment evidence with the exact Railway or ingress control, required configuration, and verification command. Mark the item deferred to Phase 12 in the PR body. Do not add an arbitrary IP threshold or trust an undocumented forwarding header.

## Required invariants

- SQLite remains the only database and `node:sqlite` remains the production implementation.
- One Railway application container and one persistent volume remain the approved deployment shape.
- Existing migration files and recorded migration names remain valid.
- Church workspace scope applies to every church-owned read and write.
- Founder-only pilot review stays founder-only.
- Packet finalization, reconciliation, correction, undo, and region replacement stay atomic.
- Coverage history stays append-only.
- Prior regions and history survive failed imports.
- Apartment data remains stored but the MVP capability remains disabled.
- No SQL string receives untrusted identifiers or values through interpolation.

## Acceptance criteria

1. Production callers no longer import outward product types from the broad raw database implementation.
2. Routes call workflow-shaped interfaces and do not coordinate row or transaction details.
3. The old broad interface shrinks by replacement. New pass-through wrappers are absent.
4. Every moved transaction retains success, conflict, rollback, idempotency, and church-isolation coverage.
5. A fresh database migrates and seeds successfully.
6. The database integration suite proves current workspace isolation and cross-church rejection.
7. Pilot-request abuse control has either a tested implementation or an exact Phase 12 deployment disposition with no invented threshold.
8. Existing behavior and JSON shapes used by the UI remain compatible unless the same PR updates callers and behavior-level tests.
9. No new production adapter or hypothetical provider seam is added.

## Focused verification

```text
pnpm db:migrate
pnpm db:seed
pnpm --dir web exec node --test db/database.test.mjs
pnpm --dir web exec node --test lib/auth.test.ts lib/authenticated-route.test.ts
pnpm --dir web exec node --test app/api/founder/pilot-requests/route.test.ts app/api/pilot-requests/route.test.ts
pnpm --dir web exec node --test app/api/coverage/route.test.ts app/api/batches/finalize/route.test.ts app/api/reconciliation/route.test.ts app/api/territory/route.test.ts
```

Then run every program check from `ORCHESTRATION.md`.

## Reviewer focus

The reviewer must answer:

- Are the new modules deep, or are they renamed collections of old exports?
- Do interfaces follow product workflows rather than database tables?
- Did any transaction split across module callers?
- Does each church-owned query still derive scope from authenticated context?
- Did the change preserve explicit coverage corrections and logical segment history?
- Is the pilot-request control based on a real trusted identity and approved policy, or correctly deferred to Phase 12?
- Can the old `database.ts` exports be deleted without complexity spreading back into callers?

## Excluded work

- PostgreSQL, Supabase, an ORM, or a query builder.
- Per-table repository generation.
- New migrations solely to make module files look cleaner.
- Public signup, billing, analytics, or multi-replica support.
- Territory job lifecycle changes, which belong to Task 03.
- Reconciliation-domain consolidation, which belongs to Task 06.

## Completion evidence

The PR must include:

- A before-and-after import map for production callers.
- The selected workflow seams and rejected shallow alternatives.
- The list of removed `database.ts` exports.
- Transaction and isolation commands with results.
- Pilot-request abuse-control implementation evidence or exact Phase 12 disposition.
