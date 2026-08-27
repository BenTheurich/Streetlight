import assert from 'node:assert/strict';
import test from 'node:test';
import { openDatabase } from '../db/migrate.mjs';
import {
  importedSegmentFixture,
  importedTerritoryFixture,
  withSeededTemeculaDatabase,
} from '../test/persistence-fixtures.ts';
import type { ImportedSegmentAddress } from './overture-import.ts';
import { getPacketGenerationWorkspace } from './packet-persistence.ts';
import { getTerritoryWorkspace, replaceTerritoryFromImport } from './territory-persistence.ts';

function saveTerritoryDraft(
  draft: Parameters<typeof replaceTerritoryFromImport>[0],
  options: {
    filename: string;
    imported: Parameters<typeof replaceTerritoryFromImport>[1];
  },
) {
  return replaceTerritoryFromImport(draft, options.imported, { filename: options.filename });
}

test('packet generation workspace joins current addresses, eligibility, heatmap, and logical reservations', () => {
  withSeededTemeculaDatabase((filename) => {
    const workspace = getTerritoryWorkspace(filename);
    const draft = {
      originAddress: workspace.originAddress,
      center: workspace.center,
      radiusMiles: workspace.radiusMiles,
      boundaryShape: workspace.boundaryShape,
      activatedSegmentIds: [],
      excludedSegmentIds: ['excluded'],
    };
    const address: ImportedSegmentAddress = {
      number: '10',
      street: 'Current Road',
      locality: 'Temecula',
      postcode: '92591',
      position: [-117.1169, 33.5429],
    };
    saveTerritoryDraft(draft, {
      filename,
      imported: importedTerritoryFixture([
        {
          ...importedSegmentFixture('current', 'Current Road', 'residential', 8),
          addresses: [address],
        },
        importedSegmentFixture('excluded', 'Excluded Road', 'residential', 5),
        importedSegmentFixture('hidden', 'Hidden Road', 'service', 4, 'hidden'),
      ]),
    });

    const database = openDatabase(filename);
    const oldPhysicalId = (
      database
        .prepare(
          `SELECT id FROM street_segments
          WHERE import_segment_id = 'current' AND is_current = 1`,
        )
        .get() as { id: string }
    ).id;
    database
      .prepare(
        `INSERT INTO batches (id, church_id, name, status, finalized_at)
        VALUES ('reserved-batch', 'church-temecula-pilot', 'Reserved', 'finalized', CURRENT_TIMESTAMP)`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO packets
          (id, church_id, batch_id, packet_code, start_address, estimated_homes, status)
        VALUES
          ('reserved-packet', 'church-temecula-pilot', 'reserved-batch', 'RES-001',
            '10 Current Road', 8, 'active')`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO packet_segments
          (church_id, packet_id, street_segment_id, sequence_number)
        VALUES ('church-temecula-pilot', 'reserved-packet', ?, 0)`,
      )
      .run(oldPhysicalId);
    database.close();

    saveTerritoryDraft(draft, {
      filename,
      imported: importedTerritoryFixture([
        {
          ...importedSegmentFixture('current', 'Current Road', 'residential', 8),
          addresses: [
            { ...address, number: '20' },
            { ...address, number: null },
          ],
        },
        importedSegmentFixture('excluded', 'Excluded Road', 'residential', 5),
        importedSegmentFixture('hidden', 'Hidden Road', 'service', 4, 'hidden'),
      ]),
    });

    const packetWorkspace = getPacketGenerationWorkspace(filename, '2026-07-28');
    const current = packetWorkspace.segments.find((segment) => segment.id === 'current');
    assert.deepEqual(current, {
      id: 'current',
      streetName: 'Current Road',
      geometry: importedSegmentFixture('current', 'Current Road', 'residential', 8).geometry,
      estimatedHomes: 8,
      eligible: true,
      reserved: true,
      coverageClass: 'red',
      lastCoveredOn: null,
      addresses: [
        { ...address, number: '20' },
        { ...address, number: null },
      ],
    });
    assert.equal(
      packetWorkspace.segments.find((segment) => segment.id === 'excluded')?.eligible,
      false,
    );
    assert.equal(
      packetWorkspace.segments.some((segment) => segment.id === 'hidden'),
      false,
    );

    const statusDatabase = openDatabase(filename);
    statusDatabase
      .prepare("UPDATE packets SET status = 'completed' WHERE id = 'reserved-packet'")
      .run();
    statusDatabase.close();
    assert.equal(
      getPacketGenerationWorkspace(filename, '2026-07-28').segments.find(
        (segment) => segment.id === 'current',
      )?.reserved,
      false,
    );
  });
});
