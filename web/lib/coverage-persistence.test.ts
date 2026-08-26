import assert from 'node:assert/strict';
import test from 'node:test';
import { openDatabase } from '../db/migrate.mjs';
import {
  importedSegmentFixture,
  importedTerritoryFixture,
  insertCoverageCompletionFixture,
  withSeededTemeculaDatabase,
} from '../test/persistence-fixtures.ts';
import { countEligibleHomesCovered } from './coverage.ts';
import {
  appendCoverageCorrection,
  getCoverageWorkspace,
  saveCoverageThresholds,
} from './coverage-persistence.ts';
import type { ImportedTerritoryInput } from './overture-import.ts';
import type { TerritoryDraftInput } from './territory-draft.ts';
import {
  getTerritoryWorkspace,
  replaceTerritoryFromImport,
  saveTerritoryDraft as saveContainedTerritoryDraft,
} from './territory-persistence.ts';

function saveTerritoryDraft(
  draft: unknown,
  options: { filename: string; imported?: ImportedTerritoryInput },
) {
  const parsedDraft = draft as TerritoryDraftInput;
  return options.imported
    ? replaceTerritoryFromImport(parsedDraft, options.imported, { filename: options.filename })
    : saveContainedTerritoryDraft(parsedDraft, { filename: options.filename });
}

test('saving heatmap ranges returns the refreshed coverage workspace', () => {
  withSeededTemeculaDatabase((filename) => {
    const workspace = saveCoverageThresholds(
      { yellowAfterDays: 30, orangeAfterDays: 60, redAfterDays: 90 },
      filename,
    );

    assert.deepEqual(workspace.thresholds, {
      yellowAfterDays: 30,
      orangeAfterDays: 60,
      redAfterDays: 90,
    });
    assert.ok(workspace.segments.length > 0);
  });
});

test('coverage reads one append-only correction, void, and restore history', () => {
  withSeededTemeculaDatabase((filename) => {
    const before = getCoverageWorkspace(filename, '2026-08-25');
    const segmentId = before.segments[0]?.id;
    assert.ok(segmentId);
    const rootId = insertCoverageCompletionFixture(segmentId, '2026-07-01', filename);
    const assertEffectiveDate = (
      returned: ReturnType<typeof getCoverageWorkspace>,
      expected: string | null,
    ) => {
      const fromMutation = returned.segments.find(({ id }) => id === segmentId);
      const reread = getCoverageWorkspace(filename, '2026-08-25').segments.find(
        ({ id }) => id === segmentId,
      );
      assert.equal(fromMutation?.lastCoveredOn, expected);
      assert.equal(reread?.lastCoveredOn, expected);
      assert.deepEqual(fromMutation?.roots, reread?.roots);
      return reread;
    };

    assertEffectiveDate(appendCoverageCorrection(rootId, '2026-07-20', filename), '2026-07-20');

    assertEffectiveDate(appendCoverageCorrection(rootId, null, filename), null);

    const restored = assertEffectiveDate(
      appendCoverageCorrection(rootId, '2026-07-21', filename),
      '2026-07-21',
    );
    assert.deepEqual(Object.keys(restored?.roots[0] ?? {}).sort(), [
      'corrections',
      'effectiveCoveredOn',
      'eventId',
      'originalCoveredOn',
      'packetId',
    ]);
    assert.deepEqual(
      restored?.roots[0]?.corrections.map(({ coveredOn, isVoid }) => ({ coveredOn, isVoid })),
      [
        { coveredOn: '2026-07-20', isVoid: false },
        { coveredOn: '2026-07-20', isVoid: true },
        { coveredOn: '2026-07-21', isVoid: false },
      ],
    );
  });
});

test('coverage workspace exposes concrete import warnings to packet generation', () => {
  withSeededTemeculaDatabase((filename) => {
    const workspace = getTerritoryWorkspace(filename);
    const imported = importedTerritoryFixture([
      importedSegmentFixture('one', 'Residential Road', 'residential', 8),
    ]);
    saveTerritoryDraft(
      {
        originAddress: workspace.originAddress,
        center: workspace.center,
        radiusMiles: workspace.radiusMiles,
        boundaryShape: workspace.boundaryShape,
      },
      { filename, imported },
    );

    assert.deepEqual(getCoverageWorkspace(filename).qualityWarnings, imported.quality.warnings);

    saveTerritoryDraft(
      {
        originAddress: workspace.originAddress,
        center: workspace.center,
        radiusMiles: workspace.radiusMiles,
        boundaryShape: workspace.boundaryShape,
      },
      {
        filename,
        imported: {
          ...imported,
          quality: {
            ...imported.quality,
            totalAddresses: 10,
            assignedAddresses: 10,
            unmatchedAddresses: 0,
            warnings: [],
          },
        },
      },
    );
    assert.deepEqual(getCoverageWorkspace(filename).qualityWarnings, []);
  });
});

test('coverage boundary appends corrections, retains retired logical history, and totals eligible homes once', () => {
  withSeededTemeculaDatabase((filename) => {
    const before = getTerritoryWorkspace(filename);
    const first = before.segments.find(
      (segment) => segment.eligible,
    ) as (typeof before.segments)[number];
    const second = before.segments.find(
      (segment) => segment.eligible && segment.id !== first.id,
    ) as (typeof before.segments)[number];
    const root = insertCoverageCompletionFixture(first.id, '2026-07-01', filename);
    const otherRoot = insertCoverageCompletionFixture(second.id, '2026-06-01', filename);
    appendCoverageCorrection(root, '2026-07-20', filename);
    appendCoverageCorrection(otherRoot, null, filename);
    const afterVoid = openDatabase(filename);
    const afterVoidCount = (
      afterVoid.prepare('SELECT COUNT(*) AS count FROM coverage_events').get() as { count: number }
    ).count;
    afterVoid.close();
    assert.throws(
      () => appendCoverageCorrection(otherRoot, null, filename),
      /Coverage event is already void/,
    );
    const afterSecondVoid = openDatabase(filename);
    assert.equal(
      (
        afterSecondVoid.prepare('SELECT COUNT(*) AS count FROM coverage_events').get() as {
          count: number;
        }
      ).count,
      afterVoidCount,
    );
    afterSecondVoid.close();
    appendCoverageCorrection(otherRoot, '2026-07-25', filename);
    const packets = openDatabase(filename);
    packets
      .prepare('INSERT INTO batches (id, church_id, name, status) VALUES (?, ?, ?, ?)')
      .run('coverage-batch', 'church-temecula-pilot', 'Coverage batch', 'finalized');
    packets
      .prepare(
        `INSERT INTO packets
          (id, church_id, batch_id, packet_code, start_address, estimated_homes, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'coverage-packet',
        'church-temecula-pilot',
        'coverage-batch',
        'COVERAGE-001',
        '1 Main St',
        1,
        'active',
      );
    packets.close();

    const workspace = getCoverageWorkspace(filename, '2026-07-28');
    assert.equal(workspace.activePackets, 1);
    assert.equal(workspace.totals.eligibleHomes, before.totals.eligibleHomes);
    assert.equal(
      workspace.segments.find((segment) => segment.id === first.id)?.lastCoveredOn,
      '2026-07-20',
    );
    assert.equal(
      workspace.segments.find((segment) => segment.id === second.id)?.lastCoveredOn,
      '2026-07-25',
    );
    assert.equal(
      workspace.segments.find((segment) => segment.id === first.id)?.roots[0]?.corrections.length,
      1,
    );

    const countDatabase = openDatabase(filename);
    const count = (
      countDatabase.prepare('SELECT COUNT(*) AS count FROM coverage_events').get() as {
        count: number;
      }
    ).count;
    countDatabase.close();
    assert.throws(
      () => appendCoverageCorrection('missing', '2026-07-26', filename),
      /Coverage event not found/,
    );
    assert.throws(
      () => appendCoverageCorrection(root, '2099-01-01', filename),
      /Invalid coverage date/,
    );
    const afterFailures = openDatabase(filename);
    assert.equal(
      (
        afterFailures.prepare('SELECT COUNT(*) AS count FROM coverage_events').get() as {
          count: number;
        }
      ).count,
      count,
    );
    afterFailures.close();

    saveTerritoryDraft(
      {
        originAddress: before.originAddress,
        center: before.center,
        radiusMiles: before.radiusMiles,
        boundaryShape: before.boundaryShape,
        activatedSegmentIds: [],
        excludedSegmentIds: [first.id],
      },
      { filename },
    );
    const excluded = getCoverageWorkspace(filename, '2026-07-28').segments.find(
      (segment) => segment.id === first.id,
    );
    assert.equal(excluded?.eligible, false);
    assert.equal(excluded?.excludedReason, 'segment');
    assert.equal(excluded?.roots[0].eventId, root);

    saveTerritoryDraft(
      {
        originAddress: before.originAddress,
        center: before.center,
        radiusMiles: before.radiusMiles,
        boundaryShape: before.boundaryShape,
        activatedSegmentIds: before.segments
          .filter((segment) => segment.activationKind === 'manual')
          .map((segment) => segment.id),
        excludedSegmentIds: before.segments
          .filter((segment) => segment.manuallyExcluded)
          .map((segment) => segment.id),
      },
      {
        filename,
        imported: importedTerritoryFixture([
          importedSegmentFixture(first.id, 'Replacement Road', 'residential', 9),
        ]),
      },
    );
    const reimported = getCoverageWorkspace(filename, '2026-07-28');
    assert.equal(reimported.segments[0]?.id, first.id);
    assert.equal(reimported.segments[0]?.lastCoveredOn, '2026-07-20');
  });
});

test('coverage thresholds persist per territory without changing coverage totals', () => {
  withSeededTemeculaDatabase((filename) => {
    const before = getCoverageWorkspace(filename, '2026-07-28');
    assert.deepEqual(before.thresholds, {
      yellowAfterDays: 90,
      orangeAfterDays: 180,
      redAfterDays: 365,
    });
    assert.equal(before.dataMode, 'canonical');
    const segment = before.segments.find((candidate) => candidate.eligible);
    assert.ok(segment);
    insertCoverageCompletionFixture(segment.id, '2026-05-29', filename);
    const beforeThresholdChange = getCoverageWorkspace(filename, '2026-07-28');
    assert.equal(
      beforeThresholdChange.segments.find((candidate) => candidate.id === segment.id)
        ?.coverageClass,
      'green',
    );
    const coveredHomes = countEligibleHomesCovered(
      beforeThresholdChange.segments,
      beforeThresholdChange.asOf,
      90,
    );

    saveCoverageThresholds(
      { yellowAfterDays: 30, orangeAfterDays: 60, redAfterDays: 90 },
      filename,
    );
    const after = getCoverageWorkspace(filename, '2026-07-28');
    assert.deepEqual(after.thresholds, {
      yellowAfterDays: 30,
      orangeAfterDays: 60,
      redAfterDays: 90,
    });
    assert.deepEqual(
      after.legend.map(({ label }) => label),
      ['0-29 days', '30-59 days', '60-89 days', '90+ days or never', 'Excluded'],
    );
    assert.equal(
      after.segments.find((candidate) => candidate.id === segment.id)?.coverageClass,
      'orange',
    );
    assert.equal(after.totals.eligibleHomes, before.totals.eligibleHomes);
    assert.equal(countEligibleHomesCovered(after.segments, after.asOf, 90), coveredHomes);
  });
});
