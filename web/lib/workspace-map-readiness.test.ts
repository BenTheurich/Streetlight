import assert from 'node:assert/strict';
import test from 'node:test';
import { createSatelliteMapReadiness, waitForWorkspaceMap } from './workspace-map-readiness.ts';

class GoogleMap {
  listeners = new Map<string, Set<() => void>>();
  addListener(event: string, listener: () => void) {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return { remove: () => listeners.delete(listener) };
  }
  emit(event: string) {
    for (const listener of this.listeners.get(event) ?? []) listener();
  }
}
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
const openMap = { whenSettled: async () => {} };

test('workspace printing waits for both the fitted overlay and selected satellite tiles', async () => {
  const satellite = createSatelliteMapReadiness();
  const map = new GoogleMap();
  satellite.observe(map);
  map.emit('tilesloaded');
  let finishOpenMap = () => {};
  const openMap = {
    whenSettled: () =>
      new Promise<void>((resolve) => {
        finishOpenMap = resolve;
      }),
  };
  let settled = false;
  const rendering = waitForWorkspaceMap(
    openMap,
    () => 'satellite',
    satellite,
    new AbortController().signal,
  ).then(() => {
    settled = true;
  });
  // Print fitting changes the viewport before the open renderer has finished.
  map.emit('bounds_changed');
  finishOpenMap();
  map.emit('idle');
  await turn();
  assert.equal(settled, false);
  map.emit('tilesloaded');
  await rendering;
  assert.equal(settled, true);
  // A second print of the same cached view needs no new tilesloaded event.
  await waitForWorkspaceMap(
    { whenSettled: async () => {} },
    () => 'satellite',
    satellite,
    new AbortController().signal,
  );
});

test('open-map printing does not wait for or initialize satellite', async () => {
  await waitForWorkspaceMap(
    openMap,
    () => 'roadmap',
    createSatelliteMapReadiness(),
    new AbortController().signal,
  );
});

test('satellite failure, detachment, and cancellation reject a pending print', async () => {
  for (const failure of ['load', 'detach', 'cancel']) {
    const satellite = createSatelliteMapReadiness();
    const map = new GoogleMap();
    const stop = satellite.observe(map);
    const controller = new AbortController();
    const rejected = assert.rejects(
      waitForWorkspaceMap(openMap, () => 'satellite', satellite, controller.signal),
    );
    await turn();
    if (failure === 'load') satellite.fail();
    else if (failure === 'detach') stop();
    else controller.abort();
    await rejected;
    stop();
    assert.equal(map.listeners.get('bounds_changed')?.size, 0);
    assert.equal(map.listeners.get('tilesloaded')?.size, 0);
  }
});
