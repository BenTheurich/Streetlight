import assert from 'node:assert/strict';
import test from 'node:test';
import { googleMapTypeId, normalizeStreetlightMapType } from './google-maps-browser.ts';

test('Streetlight exposes only map and satellite basemaps', () => {
  assert.equal(normalizeStreetlightMapType('roadmap'), 'roadmap');
  assert.equal(normalizeStreetlightMapType('satellite'), 'satellite');
  assert.equal(normalizeStreetlightMapType('hybrid'), 'satellite');
  assert.equal(normalizeStreetlightMapType('terrain'), 'roadmap');
  assert.equal(normalizeStreetlightMapType(undefined), 'roadmap');
  assert.equal(googleMapTypeId('roadmap'), 'roadmap');
  assert.equal(googleMapTypeId('satellite'), 'hybrid');
});
