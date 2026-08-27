import assert from 'node:assert/strict';
import test from 'node:test';
import { APARTMENTS_ENABLED, applyMvpCapabilities } from './product-capabilities.ts';

test('apartments are disabled for the MVP without changing stored workspace data', () => {
  const workspace = {
    apartmentComplexes: [{ id: 'complex-one' }],
    apartmentSites: [{ id: 'site-one' }],
    segments: [{ id: 'segment-one' }],
  };

  const filtered = applyMvpCapabilities(workspace);

  assert.equal(APARTMENTS_ENABLED, false);
  assert.deepEqual(filtered.apartmentComplexes, []);
  assert.deepEqual(filtered.apartmentSites, []);
  assert.equal(filtered.segments, workspace.segments);
  assert.deepEqual(workspace.apartmentComplexes, [{ id: 'complex-one' }]);
  assert.deepEqual(workspace.apartmentSites, [{ id: 'site-one' }]);
});

test('the preserved apartment implementation can be enabled through the same seam', () => {
  const workspace = {
    apartmentComplexes: [{ id: 'complex-one' }],
    apartmentSites: [{ id: 'site-one' }],
  };

  assert.equal(applyMvpCapabilities(workspace, true), workspace);
});
