import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTerritoryDraft } from './territory-draft.ts';

test('draft validation accepts unique exact segment IDs and rejects duplicates', () => {
  const valid = {
    originAddress: ' 31087 Nicolas Rd ',
    center: [-117.116885, 33.54293],
    radiusMiles: 5,
    boundaryShape: 'square',
    activatedSegmentIds: [' hidden:one '],
    excludedSegmentIds: [' visible:one '],
  };
  const parsed = parseTerritoryDraft(valid);

  assert.equal(parsed.originAddress, '31087 Nicolas Rd');
  assert.deepEqual(parsed.activatedSegmentIds, ['hidden:one']);
  assert.deepEqual(parsed.excludedSegmentIds, ['visible:one']);
  assert.throws(
    () => parseTerritoryDraft({ ...valid, activatedSegmentIds: ['same', 'same'] }),
    /duplicate/i,
  );
  assert.throws(
    () => parseTerritoryDraft({ ...valid, excludedSegmentIds: ['same', 'same'] }),
    /duplicate/i,
  );
  assert.throws(() => parseTerritoryDraft({ ...valid, radiusMiles: 5.01 }), /1 and 5 miles/i);
});
