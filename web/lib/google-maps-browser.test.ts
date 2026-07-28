import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeStreetlightMapType } from './google-maps-browser.ts';

test('Streetlight exposes only map and satellite basemaps', () => {
  assert.equal(normalizeStreetlightMapType('roadmap'), 'roadmap');
  assert.equal(normalizeStreetlightMapType('satellite'), 'satellite');
  assert.equal(normalizeStreetlightMapType('hybrid'), 'roadmap');
  assert.equal(normalizeStreetlightMapType('terrain'), 'roadmap');
  assert.equal(normalizeStreetlightMapType(undefined), 'roadmap');
});
