import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { migrateDatabase, openDatabase } from '../db/migrate.mjs';
import { seedDatabase } from '../db/seed.mjs';
import { withTemeculaWorkspace } from '../test/workspace-fixtures.ts';
import { getTerritoryWorkspace, saveTerritoryDraft } from './database.ts';
import { territoryDraftFromWorkspace } from './territory-client.ts';
import { parseTerritoryDraft } from './territory-draft.ts';

function withDatabase(run: (filename: string) => void) {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-territory-'));
  const filename = path.join(directory, 'streetlight.db');
  try {
    const database = openDatabase(filename);
    migrateDatabase(database);
    seedDatabase(database);
    database.close();
    withTemeculaWorkspace(() => run(filename));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('exact segment activation persists without activating other hidden segments', () => {
  withDatabase((filename) => {
    const seeded = getTerritoryWorkspace(filename);
    const [selected, other] = seeded.segments;
    assert.ok(selected);
    assert.ok(other);
    const database = openDatabase(filename);
    const hide = database.prepare(
      'UPDATE street_segments SET activation_kind = ? WHERE import_segment_id = ?',
    );
    hide.run('hidden', selected.id);
    hide.run('hidden', other.id);
    database.close();
    const initial = getTerritoryWorkspace(filename);
    const draft = territoryDraftFromWorkspace(initial);

    saveTerritoryDraft({ ...draft, activatedSegmentIds: [selected.id] }, { filename });

    const saved = getTerritoryWorkspace(filename);
    assert.equal(saved.segments.find(({ id }) => id === selected.id)?.activationKind, 'manual');
    assert.equal(saved.segments.find(({ id }) => id === selected.id)?.active, true);
    assert.equal(saved.segments.find(({ id }) => id === other.id)?.active, false);
  });
});

test('exact segment exclusion persists without excluding adjacent segments', () => {
  withDatabase((filename) => {
    const initial = getTerritoryWorkspace(filename);
    const selected = initial.segments.find((segment) => segment.eligible);
    assert.ok(selected);
    const draft = territoryDraftFromWorkspace(initial);

    saveTerritoryDraft({ ...draft, excludedSegmentIds: [selected.id] }, { filename });

    const saved = getTerritoryWorkspace(filename);
    const result = saved.segments.find(({ id }) => id === selected.id);
    assert.equal(result?.manuallyExcluded, true);
    assert.equal(result?.excludedReason, 'segment');
    assert.ok(saved.segments.some((segment) => segment.id !== selected.id && segment.eligible));
  });
});

test('draft validation accepts unique exact segment IDs and rejects duplicates', () => {
  const valid = {
    originAddress: ' 31087 Nicolas Rd ',
    center: [-117.116885, 33.54293],
    radiusMiles: 10,
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
});
