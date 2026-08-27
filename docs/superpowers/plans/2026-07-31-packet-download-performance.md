# Packet Download Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce five-packet PDF download time by sharing one browser context and rendering no more than three packet maps concurrently, while showing a truthful accessible loading state.

**Architecture:** Keep the existing request, retry, map document, and PDF assembly flow. Add one small ordered-concurrency helper inside the renderer, use it with pages from one Playwright context per capture attempt, and derive the visible loading copy from the existing download scope and packet counts.

**Tech Stack:** TypeScript, Node test runner, React 19, Playwright, MapLibre GL, Next.js 16.

## Global Constraints

- Preserve deterministic packet contents, page order, and all-or-nothing retries.
- Use exactly one browser context per complete capture attempt.
- Render at most three packet pages concurrently.
- Do not add dependencies, persistent PDF storage, a permanent browser, fake progress percentages, or a job queue.
- Keep existing success and recoverable-error messages unchanged.

---

### Task 1: Share the capture context and bound page concurrency

**Files:**
- Modify: `web/lib/open-map-renderer.test.ts`
- Modify: `web/lib/open-map-renderer.ts:177-218`

**Interfaces:**
- Produces: `captureOpenPacketPages(input, captureOne): Promise<Uint8Array[]>`, which preserves input order while running at most three `captureOne` calls concurrently.
- Consumes: the existing `OpenMapRenderInput`, `packetMapDocument`, and Playwright capture flow.

- [ ] **Step 1: Write the failing concurrency and order check**

Add a test that creates six render inputs, increments an active-capture counter, waits for deliberately different short delays, and returns one-byte images whose values identify the input. Assert that the maximum active count is `3` and returned byte values are `[0, 1, 2, 3, 4, 5]`.

```ts
test('captures at most three packet maps concurrently and preserves packet order', async () => {
  const inputs = Array.from({ length: 6 }, (_, index) => ({
    packetId: `packet-${index}`,
  })) as OpenMapRenderInput[];
  let active = 0;
  let maximumActive = 0;

  const images = await captureOpenPacketPages(inputs, async ({ packetId }) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    const index = Number(packetId.slice('packet-'.length));
    await new Promise((resolve) => setTimeout(resolve, (6 - index) * 2));
    active -= 1;
    return new Uint8Array([index]);
  });

  assert.equal(maximumActive, 3);
  assert.deepEqual(images.map((image) => image[0]), [0, 1, 2, 3, 4, 5]);
});
```

- [ ] **Step 2: Run the focused test and verify the missing export fails**

Run: `node --experimental-strip-types --test lib/open-map-renderer.test.ts`

Expected: FAIL because `captureOpenPacketPages` is not exported.

- [ ] **Step 3: Implement the minimal ordered worker pool and shared context**

Add `captureOpenPacketPages` beside `captureWithPlaywright`. It preallocates the result array, advances one shared index before each await, and starts `Math.min(3, input.length)` workers.

Change `captureWithPlaywright` to create one `browser.newContext(...)`, use `context.newPage()` inside the helper's `captureOne` callback, and close each page, then the context, then the browser. Keep the existing `setContent`, readiness, map-error, screenshot, and timeout behavior unchanged.

```ts
export async function captureOpenPacketPages(
  input: OpenMapRenderInput[],
  captureOne: (render: OpenMapRenderInput) => Promise<Uint8Array>,
): Promise<Uint8Array[]> {
  const images = new Array<Uint8Array>(input.length);
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, input.length) }, async () => {
      while (nextIndex < input.length) {
        const index = nextIndex;
        nextIndex += 1;
        images[index] = await captureOne(input[index]);
      }
    }),
  );
  return images;
}
```

- [ ] **Step 4: Run renderer and PDF route checks**

Run: `node --experimental-strip-types --test lib/open-map-renderer.test.ts app/api/packets/pdf/route.test.ts`

Expected: all checks PASS, including the existing complete-set retry and partial-PDF rejection checks.

- [ ] **Step 5: Commit the renderer change**

```powershell
git add web/lib/open-map-renderer.ts web/lib/open-map-renderer.test.ts
git commit -m "perf: render packet maps concurrently"
```

### Task 2: Show packet-aware accessible progress

**Files:**
- Create: `web/components/packet-download-progress.test.ts`
- Create: `web/components/packet-download-progress.ts`
- Modify: `web/components/PacketGenerator.tsx:340-380`
- Modify: `web/package.json`

**Interfaces:**
- Consumes: existing `downloading`, `latestBatch`, `finalized`, and `activePackets` values.
- Produces: `packetDownloadProgress(scope, newestPacketCount, activePacketCount)`, plus a Downloads section with `aria-busy`, disabled actions, and the visible live message `Preparing N packet maps and PDF…` during either scope.

- [ ] **Step 1: Write the failing download-progress behavior check**

Create a focused check for idle, newest-batch, and all-active-packets state. The expected values are literal and independent of the implementation.

```ts
test('packet download progress uses the selected scope count', () => {
  assert.deepEqual(packetDownloadProgress(null, 5, 12), { busy: false, message: null });
  assert.deepEqual(packetDownloadProgress('newest', 5, 12), {
    busy: true,
    message: 'Preparing 5 packet maps and PDF…',
  });
  assert.deepEqual(packetDownloadProgress('active', 5, 12), {
    busy: true,
    message: 'Preparing 12 packet maps and PDF…',
  });
});
```

- [ ] **Step 2: Run the focused component check and verify it fails**

Run: `node --experimental-strip-types --test components/packet-download-progress.test.ts`

Expected: FAIL because `packet-download-progress.ts` does not exist.

- [ ] **Step 3: Add the minimal derived state and markup**

Implement the pure helper without new state:

```ts
export function packetDownloadProgress(
  scope: 'newest' | 'active' | null,
  newestPacketCount: number,
  activePacketCount: number,
): { busy: boolean; message: string | null } {
  if (!scope) return { busy: false, message: null };
  const count = scope === 'active' ? activePacketCount : newestPacketCount;
  return { busy: true, message: `Preparing ${count} packet maps and PDF…` };
}
```

Use the helper from `PacketGenerator`, set `aria-busy={downloadProgress.busy}` on `.packet-downloads`, and render one `<p aria-live="polite">{downloadProgress.message}</p>` while the message exists. Keep both existing button disable expressions and the existing completion/error notice behavior. Add the new test file to the explicit `pnpm test` command in `web/package.json`.

- [ ] **Step 4: Run focused checks, then repository checks**

Run:

```powershell
node --experimental-strip-types --test components/packet-download-progress.test.ts
node --experimental-strip-types --test lib/open-map-renderer.test.ts app/api/packets/pdf/route.test.ts
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

Expected: every command exits `0`; the Node suite reports no failures; Biome, TypeScript, and Next.js complete without errors.

- [ ] **Step 5: Verify the live browser behavior and timing**

At `http://localhost:3001/`, open Generate packets and download the seeded newest five-packet batch. During the request, inspect that the Downloads section has `aria-busy="true"`, both buttons are disabled, and `Preparing 5 packet maps and PDF…` is visible. Confirm the PDF downloads, the success notice appears, and record elapsed time against the measured 14.7-second baseline.

- [ ] **Step 6: Commit the loading-state change**

```powershell
git add web/components/PacketGenerator.tsx web/components/packet-download-progress.ts web/components/packet-download-progress.test.ts web/package.json
git commit -m "ux: show packet PDF preparation progress"
```
