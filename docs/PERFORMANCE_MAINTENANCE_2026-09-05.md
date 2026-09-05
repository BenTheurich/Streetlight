Streetlight performance maintenance, September 5, 2026

This change applies the performance audit's fixes to main. Ben requested that the separate Phase 11 public-site work remain local. The existing public page therefore keeps its copy, navigation, images, captions, and pilot-request behavior. Responsive-image changes for the unpublished secondary pages remain with that work.

| Area | Change |
|---|---|
| Packet selection | Bound candidate-prefix traversal by the largest useful request size and reject distant geometry before exact adjacency checks. Preserve deterministic ordering, warnings, and oversized-single-segment behavior. |
| Public loading | Load the authenticated administrator through a lazy client boundary. Move workspace styles and AuthKit out of the public layout. Preserve the authenticated founder page's provider and styles. |
| Favicon and images | Replace the 1,368,745-byte favicon with a dedicated 1,654-byte PNG. Retain the original for printing. Give existing landing images responsive sizes and defer desktop artwork in compact/reduced-motion layouts. |
| Base-map data | Read map metadata, buildings, and house numbers directly. Omit unused coverage/history and apartment properties from this response. |
| Map and Progress | Reuse road groups, narrow animation subscriptions, and update selection properties through stable MapLibre feature IDs. Reset sources when geography or styles change. Start MapLibre loading alongside map data; stop continuous camera forwarding to hidden Satellite. |
| Reconciliation | Read batch summaries plus the selected batch's details. Fetch its associations together. Preserve tenant checks, corrections, history targets, read retries, and mutation locks through coverage refresh. |
| Packet quantity | Keep requested quantities as compact counts instead of eagerly allocating one object per requested packet. Preserve the existing validation and fewer-packets warning without adding a product quota. |

The existing landing animation now groups layout measurements before rendering in one animation frame and skips unchanged step writes. Its browser regression covers forward and reverse scrolling, compact images, and reduced motion. The Phase 11 secondary reveal behavior is not included.

Measurements from the implementation audit used synthetic data on the same desktop. They describe the algorithms and readers retained in this commit; they are not production latency guarantees.

| Paired workload | Before | After |
|---|---:|---:|
| Five 50-home packets, 1,500 connected segments, median of three runs | 8,324.5 ms | 43.4 ms |
| One 50-home packet, same fixture | 2,568.1 ms | 22.1 ms |
| Map reader, 7,500 buildings/house numbers, median of seven runs | 41.51 ms / 14 queries | 23.18 ms / 3 queries |
| Map JSON on that fixture | 3,341,327 bytes | 2,530,157 bytes |
| Selected reconciliation history, 520 batches / 5,200 packets, median of five runs | 841.78 ms / 10,922 queries | 5.53 ms / 4 queries |
| Reconciliation JSON on that fixture | 9,161,018 bytes | 95,136 bytes |
| Group 2,500 segments into 625 roads | 2.96 ms | 0.20 ms |
| Select a four-segment road in that territory | 9.82 ms | 0.24 ms |
| Data sent to MapLibre for that selection | 2,500 features / 515,752 bytes | 4 property changes / 173 bytes |
| Unchanged publications during 24 seconds of playback | 122 | 0 |

All JSON sizes are uncompressed. MapLibre update bytes represent local JSON-equivalent data, not HTTP traffic. Reader timings exclude JSON serialization. Generated differential checks matched the original output for 500 packet-selection cases and 200 road-grouping cases. Retained map properties and selected reconciliation details deep-equal the originals.

The earlier full-working-tree browser run used 1,500 synthetic segments and 52 weekly records. A five-packet request fell from 5,114.5 to 222.5 ms. It verified Coverage search, road highlighting, history jumps, batch switching, and a date correction. Foreground playback and presentation samples recorded no long tasks, with frame-interval p95 values of 8.4 and 8.5 ms. Some longer frames remained. Those observations include the local Phase 11 work and do not replace the checks of the main-only integration.

The full-style cache experiment was discarded: cloning the style took about 35 ms, more than its roughly 20 ms rebuild. House-label caching, larger-territory behavior, high-DPI devices, and cinematic-mask changes remain profiling candidates. The base-map geometry still occupies about 2.53 MB on the fixture, and reconciliation summaries grow with batch count.

No dependencies, schemas, providers, deployment services, or product rules changed. Finalization keeps transaction conflict checks and regeneration. Tests use disposable databases and fake provider responses. No live WorkOS organization, invitation, Google key, production database, deployment, or physical printer was exercised.

The shipping checkout is isolated from Ben's active branch. Its dependency installation, database preparation, tests, and build use their own files. The user's working tree, Git index, branch, and local preview remain separate.

Main-only verification completed before commit:

- A frozen pnpm 10.27.0 installation, local migration, and seed passed in the shipping checkout.
- The repository command `pnpm check` passed: Biome checked 176 files; TypeScript passed; 367 application tests, four Python-launcher tests, and 71 importer tests passed; Next.js 16.3.0 produced the production build. Total: 442 tests with no failures or skips.
- Seven rendered browser contracts passed, including the existing public request form and the added compact/reduced-motion/scroll regression. The three-test difference from the earlier 445-test working-tree run reflects excluded Phase 11 and demo work.
- The main-only production site rendered in the Codex browser. The pilot-request drawer opened and closed, with no console warnings or errors. Its shared public stylesheet is 2,446 bytes; workspace styles remain separate.
- `git diff --check` passed. The generated Next type imports were restored to their committed form after the build. No instrumentation, fake-auth routes, local databases, Phase 11 files, or dependency changes are included.
- Every canonical file, its Git index, branch, and HEAD matched the snapshot taken before preparing the shipping checkout. The temporary verification server used port 3119 and was stopped; the user's port 3118 preview was left running.
