import assert from 'node:assert/strict';
import test from 'node:test';
import type { CoverageWorkspace } from './coverage.ts';
import type { MapCamera } from './map-camera.ts';
import {
  createOutreachProgressWorkflow,
  type ProgressBrowser,
} from './outreach-progress-workflow.ts';

const coverage = {
  asOf: '2026-08-02',
  apartmentComplexes: [],
  segments: ['2025-12-10', '2026-01-20', '2026-02-20'].map((date, index) => ({
    id: String(index),
    streetName: `Street ${index}`,
    roadGroupId: String(index),
    estimatedHomes: 10,
    geometry: {
      type: 'LineString',
      coordinates: [
        [0, 0],
        [0.1, 0.1],
      ],
    },
    roots: [{ effectiveCoveredOn: date, packetId: `packet-${index}` }],
  })),
} as unknown as CoverageWorkspace;

function deferred(signal?: AbortSignal) {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
  return { promise, resolve, reject };
}

class Browser implements ProgressBrowser {
  frames = new Map<number, (time: number) => void>();
  frameId = 0;
  now = 0;
  events: Parameters<ProgressBrowser['observe']>[0] | null = null;
  fullscreenFailure = false;
  fullscreenRequest: Promise<void> | null = null;
  fullscreen = false;
  entries = 0;
  exits = 0;
  focuses = 0;
  prints = 0;
  original: MapCamera = { center: [-117, 33], zoom: 13 };
  restored: MapCamera[] = [];
  preparation: ReturnType<typeof deferred> | null = null;
  dialog: ReturnType<typeof deferred> | null = null;

  requestFrame(callback: (time: number) => void) {
    this.frames.set(++this.frameId, callback);
    return this.frameId;
  }
  cancelFrame(frame: number) {
    this.frames.delete(frame);
  }
  observe(events: Parameters<ProgressBrowser['observe']>[0]) {
    this.events = events;
    return () => {
      this.events = null;
    };
  }
  async enterFullscreen() {
    this.entries += 1;
    if (this.fullscreenFailure) throw new Error('Denied');
    await this.fullscreenRequest;
    this.fullscreen = true;
  }
  async exitFullscreen() {
    this.exits += 1;
    this.fullscreen = false;
  }
  focusPresentation() {
    this.focuses += 1;
  }
  getCamera() {
    return this.original;
  }
  restoreCamera(camera: MapCamera) {
    this.restored.push(camera);
  }
  preparePrint(signal: AbortSignal) {
    this.preparation = deferred(signal);
    return this.preparation.promise;
  }
  print(signal: AbortSignal) {
    this.prints += 1;
    this.dialog = deferred(signal);
    return this.dialog.promise;
  }
  advance(milliseconds: number) {
    for (let elapsed = 0; elapsed < milliseconds; elapsed += 40) {
      this.now += 40;
      const pending = [...this.frames.values()];
      this.frames.clear();
      for (const callback of pending) callback(this.now);
    }
  }
}

test('period edits stop playback, while leaving tools preserves a scrubbed period and position', async () => {
  const browser = new Browser();
  const workflow = createOutreachProgressWorkflow(coverage, browser);
  await workflow.act({ kind: 'play' });
  browser.advance(1000);
  assert.ok(workflow.getSnapshot().position > 0);
  assert.ok(workflow.getSnapshot().position < 1);
  await workflow.act({ kind: 'year', year: 2025 });
  assert.equal(workflow.getSnapshot().playing, false);
  assert.equal(workflow.getSnapshot().position, 1);
  assert.equal(browser.frames.size, 0);
  await workflow.act({ kind: 'mode', mode: 'rolling' });
  assert.equal(workflow.getSnapshot().progress.dates.length, 3);
  await workflow.act({ kind: 'position', position: 1 });
  await workflow.act({ kind: 'exit' });
  assert.equal(workflow.getSnapshot().progress.mode, 'rolling');
  assert.equal(workflow.getSnapshot().position, 1);
});

test('admin playback stops at completion, presentation rests and repeats, and cleanup cancels frames', async () => {
  const browser = new Browser();
  const workflow = createOutreachProgressWorkflow(coverage, browser);
  const stop = workflow.start();
  await workflow.act({ kind: 'play' });
  browser.advance(5000);
  assert.equal(workflow.getSnapshot().playing, false);
  assert.equal(workflow.getSnapshot().position, 2);
  await workflow.act({ kind: 'present' });
  browser.advance(5000);
  assert.equal(workflow.getSnapshot().playing, true);
  assert.equal(workflow.getSnapshot().position, 2);
  browser.advance(4000);
  assert.ok(workflow.getSnapshot().position < 1);
  stop();
  assert.equal(browser.frames.size, 0);
  assert.equal(browser.events, null);
  assert.equal(workflow.getSnapshot().displayMode, 'admin');
});

test('reduced motion completes the map and fullscreen denial retains an escapable composition', async () => {
  const browser = new Browser();
  browser.fullscreenFailure = true;
  const workflow = createOutreachProgressWorkflow(coverage, browser);
  workflow.start();
  await workflow.act({ kind: 'present' });
  browser.events?.reducedMotion(true);
  assert.equal(workflow.getSnapshot().position, 2);
  assert.equal(workflow.getSnapshot().playing, false);
  assert.equal(browser.frames.size, 0);
  assert.equal(workflow.getSnapshot().displayMode, 'presentation');
  browser.events?.exit();
  assert.equal(workflow.getSnapshot().displayMode, 'admin');
  assert.equal(browser.focuses, 1);
  browser.events?.reducedMotion(false);
  await workflow.act({ kind: 'play' });
  assert.equal(workflow.getSnapshot().playing, true);
});

test('presentation reuses completed-date metrics and does not publish during the finished rest', async () => {
  const browser = new Browser();
  const workflow = createOutreachProgressWorkflow(coverage, browser);
  await workflow.act({ kind: 'present' });
  const initialMetrics = workflow.getSnapshot().snapshot;
  browser.advance(400);
  assert.equal(workflow.getSnapshot().snapshot, initialMetrics);
  browser.advance(4600);
  assert.equal(workflow.getSnapshot().position, 2);
  const resting = workflow.getSnapshot();
  let publishes = 0;
  workflow.subscribe(() => {
    publishes += 1;
  });
  browser.advance(3000);
  assert.equal(publishes, 0);
  assert.equal(workflow.getSnapshot(), resting);
  browser.advance(1500);
  assert.ok(publishes > 0);
  assert.ok(workflow.getSnapshot().position < 1);
  await workflow.act({ kind: 'exit' });
});

test('late fullscreen success cannot leave admin mode fullscreen or cancel a newer presentation', async () => {
  const browser = new Browser();
  const workflow = createOutreachProgressWorkflow(coverage, browser);
  const first = deferred();
  browser.fullscreenRequest = first.promise;
  await workflow.act({ kind: 'present' });
  await workflow.act({ kind: 'exit' });
  first.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(workflow.getSnapshot().displayMode, 'admin');
  assert.equal(browser.fullscreen, false);

  const older = deferred();
  browser.fullscreenRequest = older.promise;
  await workflow.act({ kind: 'present' });
  await workflow.act({ kind: 'exit' });
  browser.fullscreenRequest = null;
  await workflow.act({ kind: 'present' });
  older.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(workflow.getSnapshot().displayMode, 'presentation');
  assert.equal(browser.fullscreen, true);
  await workflow.act({ kind: 'exit' });
});

test('printing waits for the committed settled map and restores the camera only after dialog dismissal', async () => {
  const browser = new Browser();
  const workflow = createOutreachProgressWorkflow(coverage, browser);
  const printing = workflow.act({ kind: 'print' });
  assert.equal(workflow.getSnapshot().displayMode, 'print');
  assert.equal(workflow.getSnapshot().position, 2);
  browser.advance(10_000);
  assert.equal(browser.prints, 0);
  browser.preparation?.resolve();
  await Promise.resolve();
  assert.equal(browser.prints, 1);
  assert.deepEqual(browser.restored, []);
  browser.dialog?.resolve(); // Both Print and Cancel dismiss the native dialog.
  await printing;
  assert.deepEqual(browser.restored, [browser.original]);
  assert.equal(workflow.getSnapshot().displayMode, 'admin');
  assert.equal(workflow.getSnapshot().error, '');
});

test('Escape cancels print preparation and failed map readiness reports a recoverable error', async () => {
  const browser = new Browser();
  const workflow = createOutreachProgressWorkflow(coverage, browser);
  workflow.start();
  const cancelled = workflow.act({ kind: 'print' });
  browser.events?.exit();
  await cancelled;
  browser.preparation?.resolve();
  assert.equal(browser.prints, 0);
  assert.deepEqual(browser.restored, [browser.original]);
  assert.equal(workflow.getSnapshot().error, '');
  const failed = workflow.act({ kind: 'print' });
  browser.preparation?.reject(new Error('Tile unavailable'));
  await failed;
  assert.equal(workflow.getSnapshot().displayMode, 'admin');
  assert.match(workflow.getSnapshot().error, /Try printing again/);
  const retry = workflow.act({ kind: 'print' });
  browser.preparation?.resolve();
  await Promise.resolve();
  browser.dialog?.resolve();
  await retry;
  assert.equal(browser.prints, 1);
  assert.equal(workflow.getSnapshot().error, '');
});

test('empty periods cannot play, present, or print, and current completion follows refreshed coverage', async () => {
  const browser = new Browser();
  const workflow = createOutreachProgressWorkflow(coverage, browser);
  workflow.update({ ...coverage, segments: [] });
  for (const kind of ['play', 'present', 'print'] as const) await workflow.act({ kind });
  assert.equal(workflow.getSnapshot().playing, false);
  assert.equal(workflow.getSnapshot().displayMode, 'admin');
  assert.equal(browser.entries, 0);
  assert.equal(browser.preparation, null);
  workflow.update(coverage);
  assert.equal(workflow.getSnapshot().position, 2);
  assert.equal(workflow.getSnapshot().snapshot.completedPackets, 2);
});
