# Task 05: Deepen the map overlay lifecycle

## Objective

Hide MapLibre source, layer, event, style-replacement, republishing, visibility, and cleanup details behind one deep overlay lifecycle interface.

Add application security headers that preserve the approved WorkOS, MapLibre, open-tile, Google Maps, and local asset paths, with browser evidence that the headers do not break current flows.

## Program position

- Branch: `codex/arch-05-map-lifecycle`
- PR base: `codex/architecture-review`
- Depends on: Tasks 01 through 04 merged
- Required next task: Task 06

Follow `ORCHESTRATION.md` for the complete task cycle.

## Required context

Read:

- `PRODUCT.md` map-provider and printable-map requirements.
- The Phase 9 map and Region Setup checkpoints in `IMPLEMENTATION_PLAN.md`.
- `docs/PRINT_MAP_RENDERING_GUIDE.md`.
- `web/components/WorkspaceMap.tsx`.
- `web/components/OpenCoverageMap.tsx`.
- `web/components/OpenTerritoryMap.tsx`.
- `web/components/OpenProgressMap.tsx`.
- `web/components/PacketProposalMap.tsx`.
- `web/components/OpenReconciliationOverlay.tsx`.
- `web/lib/territory-map-style.ts` and `web/lib/open-map-style.ts`.
- Relevant map-camera and style tests.
- `web/next.config.mjs`, `web/proxy.ts`, WorkOS configuration, and current Google Maps loaders.

## Observed pressure

`WorkspaceMap` publishes a raw MapLibre object through `onMapChange`. Five overlay callers then own MapLibre sources, layers, IDs, insertion order, paint updates, event listeners, and cleanup. Overlay refresh also uses several style-replacement strategies, including map republishing and style revision state.

Recent commits repaired overlays after style changes, maps lost during data refresh, reconciliation highlight visibility, and road interaction after satellite switching. That history places the seam at overlay lifecycle ownership rather than at another style helper.

`next.config.mjs` currently defines development origins and a server package exception. It does not define content security policy or other application security headers.

## Scope

### Overlay lifecycle module

Select one interface that accepts Streetlight overlay data, appearance, interaction intent, and visibility. The implementation owns:

- Stable source and layer IDs.
- Source and layer creation order.
- Placement relative to base-map labels.
- Data updates without base-map recreation.
- Event listener registration and removal.
- Marker creation and removal.
- Style replacement and overlay republishing.
- Cleanup on unmount or map replacement.
- Observable errors and ready state.

Use the production MapLibre adapter and a deterministic test adapter. This is a real seam because both adapters exercise the same lifecycle behavior.

Do not expose raw MapLibre objects through ordinary workspace callers after migration. A private escape inside the map implementation is acceptable only when a provider operation cannot be represented by current product intent and the reviewer agrees that exposing it does not spread lifecycle knowledge.

### Preserve deep cartography modules

Keep `open-map-style.ts` and cohesive map-style computations. They already hide deterministic cartography behind small interfaces. Move only lifecycle ownership and duplicated provider operations.

### Replace source-text map tests

Replace tests that search for source IDs, callback text, raw `map.on` calls, or style-load syntax with adapter-backed lifecycle tests. Keep exact style-expression tests where the expression itself is approved cartographic behavior.

Move the map-specific assertions out of `StreetlightWorkspace.test.mjs` or delete them when new behavior tests replace them.

### Security headers

Add the smallest production header set supported by the current application. Include a content security policy only after enumerating actual current connections and scripts from:

- WorkOS AuthKit.
- MapLibre workers and styles.
- OpenFreeMap and approved open-data tile or glyph endpoints.
- Google Maps JavaScript, geocoding, and satellite use.
- Local images, fonts, blobs, and printable map rendering.

Prefer named provider origins over wildcards. Keep development exceptions separate from production. Add standard content-type, referrer, framing, and permissions controls where they do not conflict with WorkOS authentication or map providers.

Do not guess a provider origin. Use current official provider documentation and observed browser requests. If one approved provider requires a weaker directive, name the directive and evidence in the PR.

## Required invariants

- Ordinary map viewing uses MapLibre and does not load Google Maps.
- Satellite mode initializes Google Maps lazily and reuses its mounted instance.
- Map and satellite preserve camera and Streetlight overlays.
- Printable packet maps stay on the pinned open-data cartography and never use Google imagery.
- Style replacement restores every active Streetlight overlay once.
- Data refresh updates overlays without recreating the base map.
- Exact road selection, box selection, cluster expansion, hover, and pointer cleanup remain correct.
- Reduced-motion behavior remains intact.
- Apartment markers remain hidden while the capability is disabled.
- Security headers preserve sign-in, maps, tiles, workers, images, PDF rendering, and local development.

## Acceptance criteria

1. Ordinary overlay callers no longer own raw MapLibre source, layer, listener, style-load, or cleanup sequences.
2. One lifecycle module owns registration, republishing, updates, visibility, and cleanup.
3. Production and test adapters cross the same interface.
4. Tests cover initial registration, data update, style replacement, repeated replacement, visibility, interaction dispatch, error handling, unmount cleanup, and map replacement.
5. Tests prove listeners and sources do not duplicate across rerenders or style changes.
6. Source-text map assertions are removed when adapter-backed behavior tests replace them.
7. `open-map-style.ts` retains its deterministic cartography role.
8. Production security headers are present and checked through HTTP responses.
9. Signed-in browser checks show no blocked required WorkOS, MapLibre, open-tile, Google, image, or PDF request.
10. No apartment markers or controls become visible.

## Focused verification

```text
pnpm --dir web exec node --test lib/map-camera.test.ts lib/open-map-style.test.ts lib/territory-map-style.test.ts
pnpm --dir web exec node --test <new overlay lifecycle tests>
pnpm --dir web exec node --test components/StreetlightWorkspace.test.mjs
pnpm --dir web exec node --test app/api/map/route.test.ts
pnpm --dir web exec node --test lib/open-map-renderer.test.ts lib/packet-pdf.test.ts
```

Then run every program check from `ORCHESTRATION.md`.

Run a browser matrix with the response console and network failures visible:

1. Signed-out public landing and login redirect.
2. Signed-in Coverage on Map.
3. Switch Map to Satellite and back twice.
4. Change heatmap settings and select a road.
5. Open Region Setup, select exact roads, and replace the base style.
6. Open packet proposals and reconciliation highlighting.
7. Download a packet PDF.
8. Repeat at desktop and portrait-tablet widths.

If an authenticated session is unavailable, the task PR may merge into the integration branch after automated checks and reviewer approval. The final integration PR remains blocked until this matrix passes.

## Reviewer focus

The reviewer must answer:

- Did raw MapLibre lifecycle knowledge disappear from callers?
- Is the new module deep, or is it a collection of one-line map wrappers?
- Do tests prove observable overlay behavior through the test adapter?
- Can style replacement duplicate listeners or lose selected state?
- Did the change preserve the deep cartography module rather than rewrite it?
- Do security headers use exact current provider requirements without broad wildcards?
- Does the browser evidence account for WorkOS, open maps, Google satellite, images, and PDFs?

## Excluded work

- New map providers or style redesign.
- Printable cartography changes.
- Apartment marker design.
- Generic rendering engine or plugin registry.
- Region workflow state already owned by Task 04.

## Completion evidence

The PR must include:

- The selected lifecycle interface and adapter responsibilities.
- Removed raw-map caller code and source-text tests.
- Lifecycle test results.
- The exact production security headers.
- Browser console and network observations, or the final-integration blocker.
