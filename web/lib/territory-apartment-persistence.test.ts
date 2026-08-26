import assert from 'node:assert/strict';
import test from 'node:test';
import {
  importedApartmentFixture,
  importedSegmentFixture,
  importedTerritoryFixture,
  withSeededTemeculaDatabase,
} from '../test/persistence-fixtures.ts';
import type { ImportedTerritoryInput } from './overture-import.ts';
import type { TerritoryDraftInput } from './territory-draft.ts';
import {
  getTerritoryWorkspace,
  replaceTerritoryFromImport,
  saveApartmentSiteConfiguration,
  saveApartmentSiteMembership,
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

test('apartment imports remain visible as unconfigured site evidence', () => {
  withSeededTemeculaDatabase((filename) => {
    const initial = getTerritoryWorkspace(filename);
    const draft = {
      originAddress: initial.originAddress,
      center: initial.center,
      radiusMiles: 1,
      boundaryShape: 'circle',
      activatedSegmentIds: [],
      excludedSegmentIds: [],
    };
    saveTerritoryDraft(draft, {
      filename,
      imported: {
        ...importedTerritoryFixture([
          importedSegmentFixture('road', 'Sample Road', 'residential', 1),
        ]),
        radiusMiles: 1,
        apartmentSites: [
          importedApartmentFixture('apartments-10'),
          importedApartmentFixture('units-20'),
          importedApartmentFixture('missing-address', null),
        ],
      },
    });

    const imported = getTerritoryWorkspace(filename);
    assert.deepEqual(
      imported.apartmentSites
        .map(({ id, groupingKind, groupingConfirmed, packetReady, includedInPackets }) => ({
          id,
          groupingKind,
          groupingConfirmed,
          packetReady,
          includedInPackets,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      [
        {
          id: 'apartments-10',
          groupingKind: 'ungrouped',
          groupingConfirmed: false,
          packetReady: false,
          includedInPackets: false,
        },
        {
          id: 'missing-address',
          groupingKind: 'ungrouped',
          groupingConfirmed: false,
          packetReady: false,
          includedInPackets: false,
        },
        {
          id: 'units-20',
          groupingKind: 'ungrouped',
          groupingConfirmed: false,
          packetReady: false,
          includedInPackets: false,
        },
      ],
    );
  });
});

test('address, tract quantity, access, and inclusion control apartment packets', () => {
  withSeededTemeculaDatabase((filename) => {
    const initial = getTerritoryWorkspace(filename);
    const draft = {
      originAddress: initial.originAddress,
      center: initial.center,
      radiusMiles: 1,
      boundaryShape: 'circle',
      activatedSegmentIds: [],
      excludedSegmentIds: [],
    };
    saveTerritoryDraft(draft, {
      filename,
      imported: {
        ...importedTerritoryFixture([
          importedSegmentFixture('road', 'Sample Road', 'residential', 1),
        ]),
        radiusMiles: 1,
        apartmentSites: [importedApartmentFixture('apartments-10')],
      },
    });
    const site = getTerritoryWorkspace(filename).apartmentSites[0];

    assert.throws(
      () =>
        saveApartmentSiteConfiguration(
          {
            id: site.id,
            name: site.name,
            address: '10 Sample Road, Temecula CA 92591',
            addressConfirmed: false,
            tractCount: 24,
            accessStatus: 'unknown',
            groupingConfirmed: false,
            includedInPackets: true,
          },
          filename,
        ),
      /address, tract quantity, and access/i,
    );

    const included = saveApartmentSiteConfiguration(
      {
        id: site.id,
        name: site.name,
        address: '10 Sample Road, Temecula CA 92591',
        addressConfirmed: false,
        tractCount: 24,
        accessStatus: 'restricted',
        groupingConfirmed: false,
        includedInPackets: true,
      },
      filename,
    ).apartmentSites[0];
    assert.equal(included.includedInPackets, true);
    assert.equal(included.groupingConfirmed, true);
    assert.equal(included.addressConfirmed, true);

    const invalidated = saveApartmentSiteConfiguration(
      {
        id: included.id,
        name: included.name,
        address: included.address,
        addressConfirmed: included.addressConfirmed,
        tractCount: null,
        accessStatus: included.accessStatus,
        groupingConfirmed: included.groupingConfirmed,
        includedInPackets: true,
      },
      filename,
    ).apartmentSites[0];
    assert.equal(invalidated.includedInPackets, false);
  });
});

test('membership edits restore evidence and confirmed sites survive imports', () => {
  withSeededTemeculaDatabase((filename) => {
    const initial = getTerritoryWorkspace(filename);
    const draft = {
      originAddress: initial.originAddress,
      center: initial.center,
      radiusMiles: 1,
      boundaryShape: 'circle',
      activatedSegmentIds: [],
      excludedSegmentIds: [],
    };
    const imported = {
      ...importedTerritoryFixture([
        importedSegmentFixture('road', 'Sample Road', 'residential', 1),
      ]),
      radiusMiles: 1,
      apartmentSites: [
        importedApartmentFixture('apartments-10'),
        importedApartmentFixture('units-20'),
      ],
    };
    saveTerritoryDraft(draft, { filename, imported });
    const group = saveApartmentSiteMembership(
      { id: null, memberIds: ['apartments-10', 'units-20'] },
      filename,
    ).apartmentSites[0];

    saveApartmentSiteConfiguration(
      {
        id: group.id,
        name: 'Saved Site',
        address: '10 Sample Road, Temecula CA 92591',
        addressConfirmed: true,
        tractCount: 12,
        accessStatus: 'open',
        groupingConfirmed: true,
        includedInPackets: true,
      },
      filename,
    );

    const edited = saveApartmentSiteMembership(
      { id: group.id, memberIds: ['apartments-10'] },
      filename,
    );
    assert.deepEqual(
      edited.apartmentSites.map((site) => [
        site.groupingConfirmed,
        site.members.map(({ id }) => id),
      ]),
      [
        [true, ['apartments-10']],
        [false, ['units-20']],
      ],
    );
    const editedSite = edited.apartmentSites.find(({ id }) => id === group.id);
    assert.ok(editedSite);
    assert.equal(editedSite.includedInPackets, false);
    assert.equal(editedSite.groupingConfirmed, true);
    assert.equal(editedSite.tractCount, 12);
    saveTerritoryDraft(draft, { filename, imported });

    const reimported = getTerritoryWorkspace(filename);
    const preserved = reimported.apartmentSites.find(({ id }) => id === group.id);
    assert.ok(preserved);
    assert.equal(preserved.name, group.name);
    assert.equal(preserved.tractCount, 12);
    assert.equal(preserved.includedInPackets, false);
    assert.deepEqual(
      preserved.members.map(({ id }) => id),
      ['apartments-10'],
    );
    assert.equal(
      reimported.apartmentSites.filter((site) =>
        site.members.some(({ id }) => id === 'apartments-10'),
      ).length,
      1,
    );
  });
});
