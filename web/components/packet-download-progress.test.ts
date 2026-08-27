import assert from 'node:assert/strict';
import test from 'node:test';
import { packetDownloadProgress } from './packet-download-progress.ts';

test('packet download progress uses the selected scope count', () => {
  assert.deepEqual(packetDownloadProgress(null, 5, 12), { busy: false, message: null });
  assert.deepEqual(packetDownloadProgress('newest', 5, 12), {
    busy: true,
    headline: 'Preparing newest batch PDF',
    message: 'Preparing 5 packet maps and PDF…',
  });
  assert.deepEqual(packetDownloadProgress('active', 5, 12), {
    busy: true,
    headline: 'Preparing active packet PDF',
    message: 'Preparing 12 packet maps and PDF…',
  });
});
