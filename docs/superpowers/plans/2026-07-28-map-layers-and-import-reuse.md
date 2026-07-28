# Map Layers and Import Reuse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the approved Google-style Layers chooser and reuse stored Overture data whenever it contains the proposed territory.

**Architecture:** `needsTerritoryImport` compares latitude-aware square footprints using the existing territory geometry function. A focused React control owns the Layers card and basemap chooser while the existing shared map remains the only Google map instance.

**Tech Stack:** Next.js 16, React 19, TypeScript, Google Maps JavaScript API, Node test runner, Biome

## Global Constraints

- Do not create a second Google map or request a Static Maps thumbnail.
- Keep Google attribution visible.
- Keep Streetlight deterministic and AI-free.
- Use the saved import center and radius as the reusable square footprint.
- Execute inline without subagents.

---

### Task 1: Reuse contained import footprints

**Files:**
- Modify: `web/lib/territory-import.test.ts`
- Modify: `web/lib/territory-import.ts`

**Interfaces:**
- Consumes: `territoryBoundary(center, radiusMiles, 'square')`
- Produces: unchanged `needsTerritoryImport(imported, draft): boolean`

- [x] **Step 1: Add failing containment checks**

Add cases proving that a smaller shifted draft inside the saved square returns `false`, the same
shift at the full radius returns `true`, and negligible coordinate noise returns `false`.

- [x] **Step 2: Verify the new checks fail**

Run:

```powershell
node --experimental-strip-types --test lib/territory-import.test.ts
```

Expected: the contained shifted-footprint assertion fails because center equality is still strict.

- [x] **Step 3: Replace center equality with square containment**

Use `territoryBoundary` for both saved and proposed square footprints. Return `true` when the
proposed west, south, east, or north edge exceeds the saved edge by more than `1e-9` degrees.
Retain every existing proof-data, release, normalizer, quality, and missing-metadata rule.

- [x] **Step 4: Verify the focused checks pass**

Run:

```powershell
node --experimental-strip-types --test lib/territory-import.test.ts
```

Expected: all territory-import checks pass.

### Task 2: Replace native map pills with the Layers card

**Files:**
- Create: `web/components/MapLayersControl.tsx`
- Create: `web/lib/google-maps-browser.test.ts`
- Modify: `web/lib/google-maps-browser.ts`
- Modify: `web/components/AdminMap.tsx`
- Modify: `web/components/StreetlightWorkspace.tsx`
- Modify: `web/app/globals.css`
- Modify: `web/package.json`
- Modify: `IMPLEMENTATION_PLAN.md`

**Interfaces:**
- Consumes: the existing shared `google.maps.Map | null`
- Produces: `MapLayersControl({ map })` and
  `normalizeStreetlightMapType(value): 'roadmap' | 'satellite'`

- [x] **Step 1: Add the failing basemap normalization check**

Test that `roadmap` and `satellite` remain unchanged while unsupported Google map types normalize
to `roadmap`.

- [x] **Step 2: Verify the check fails**

Run:

```powershell
node --experimental-strip-types --test lib/google-maps-browser.test.ts
```

Expected: module export failure for `normalizeStreetlightMapType`.

- [x] **Step 3: Implement the minimum control**

Add the normalizer, disable `mapTypeControl` in `AdminMap`, and render one `MapLayersControl` above
the map. The control:

- displays a local CSS aerial-style thumbnail, layer icon, and `Layers` label;
- opens a two-choice Map/Satellite panel;
- visibly marks the active choice;
- calls `map.setMapTypeId` on selection;
- listens for `maptypeid_changed`;
- closes on selection, Escape, or outside pointer input; and
- uses `aria-expanded`, `aria-controls`, and an accessible choice group.

- [x] **Step 4: Style without another map request**

Position the control above the lower-left attribution. Build its thumbnail using CSS gradients and
shapes only. Keep the chooser compact and usable over both basemaps.

- [x] **Step 5: Run complete automated verification**

Run:

```powershell
node --experimental-strip-types --test app/api/coverage/route.test.ts app/api/packet-proposals/route.test.ts components/CoverageDashboard.test.mjs db/database.test.mjs lib/coverage.test.ts lib/google-maps-browser.test.ts lib/google-maps-server.test.ts lib/overture-import.test.ts lib/packet-selection.test.ts lib/territory-client.test.ts lib/territory-geometry.test.ts lib/territory-import.test.ts lib/territory-map-style.test.ts lib/territory.test.ts
.\node_modules\.bin\biome.cmd check .
node node_modules/typescript/bin/tsc --noEmit
node node_modules/next/dist/bin/next build
```

Expected: all checks exit zero and the production route list still contains only `/` plus the
existing APIs.

- [x] **Step 6: Verify in the live browser**

Confirm the Layers card, chooser open/close behavior, Map/Satellite switching, persistent tool
state, attribution clearance, and the absence of Google's native map-type pills. In Territory
Setup, confirm an ordinary contained edit does not show the import notice while a boundary
expansion beyond the saved footprint does.

- [x] **Step 7: Commit**

```powershell
git add IMPLEMENTATION_PLAN.md web/app/globals.css web/components/AdminMap.tsx web/components/MapLayersControl.tsx web/components/StreetlightWorkspace.tsx web/lib/google-maps-browser.test.ts web/lib/google-maps-browser.ts web/lib/territory-import.test.ts web/lib/territory-import.ts web/package.json
git commit -m "feat: add layers control and reuse imported territory"
```
