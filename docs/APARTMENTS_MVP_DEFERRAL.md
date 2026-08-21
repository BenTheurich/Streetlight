# Apartment support after the MVP

Decision date: 2026-08-21

Decision owner: Ben Theurich

## Decision

Streetlight will launch its first MVP without apartment workflows. Apartments are a useful future
capability, but they are not required to validate whether churches need the core street-based
Coverage, Generate, Print, and Reconcile cycle.

The existing apartment implementation remains in the repository. It is disabled at one product
capability boundary rather than deleted, forked, or controlled by deployment configuration.

## MVP behavior

For a normal MVP request, Streetlight:

- keeps apartment setup controls behind the disabled capability and shows one quiet `Apartments`
  row with `Coming later` in Region Setup;
- omits apartment markers and the apartment marker setting;
- omits apartment sites from coverage and outreach progress;
- excludes apartments from new packet proposals and rejects stale apartment proposals during
  finalization;
- rejects direct apartment configuration and grouping requests;
- continues the normal street workflow without apartment-specific copy or metrics.

This boundary does not delete or rewrite apartment data. The importer, database schema, migrations,
raw workspace readers, grouping and configuration logic, marker logic, packet selection, PDF
support, reconciliation support, and focused tests remain available in the codebase.

Previously finalized apartment packets remain readable, downloadable, reconcilable, correctable,
and cancellable. This is recovery behavior for existing records, not a path for creating new
apartment work during the MVP.

## Code boundary

[`web/lib/product-capabilities.ts`](../web/lib/product-capabilities.ts) owns the single switch:

```ts
export const APARTMENTS_ENABLED = false;
```

`applyMvpCapabilities` removes apartment collections from outward-facing workspaces while leaving
the raw database results untouched. The page loader and Coverage, Map, Territory, Packet Proposal,
and Batch Finalization paths use this boundary. The apartment mutation route uses the same constant.
Visible apartment controls use the constant directly so the retained implementation stays compiled
and type-checked.

Do not add a second apartment flag, environment variable, database setting, or partial rollout
mode. A second seam would make the behavior harder to reason about and easier to re-enable by
accident.

The fully enabled implementation immediately before this decision is preserved at commit
`88f0fbf` on the remote branch `codex/phase-9-ux-polish`.

## Restoring apartments

Restoration requires a new founder decision. Then:

1. Set `APARTMENTS_ENABLED` to `true`.
2. Update `PRODUCT.md` and `IMPLEMENTATION_PLAN.md` so apartments are again active product scope.
3. Run the complete Node and Python suites, lint, typecheck, production build, and whitespace check.
4. In a real signed-in browser, verify apartment import evidence, Setup search and grouping,
   autosave recovery, marker clustering, Map and Satellite display, inclusion gating, packet
   proposal and finalization, restricted-access PDF copy, reconciliation, corrections, and
   outreach progress.
5. Confirm that both preserved apartment records and newly imported records behave correctly before
   merging or deploying the change.

Until those steps are complete, future agents should preserve apartment code and data but keep the
MVP boundary disabled.
