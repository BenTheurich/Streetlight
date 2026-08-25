import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  ApartmentSite,
  ApartmentSiteConfigurationInput,
  TerritoryWorkspace,
} from '../lib/territory-workspace.ts';
import {
  optimisticApartmentConfiguration,
  resolveApartmentMutation,
} from './apartment-mutation-state.ts';

const configuredSite: ApartmentSite = {
  id: 'apartment-1',
  sourceId: 'source-apartment-1',
  name: null,
  address: '200 Main Street',
  position: [-117.09, 33.51],
  boundary: null,
  groupingKind: 'admin_group',
  groupingConfirmed: true,
  addressConfirmed: true,
  tractCount: 24,
  accessStatus: 'open',
  includedInPackets: true,
  packetReady: true,
  members: [
    {
      id: 'building-1',
      sourceId: 'source-building-1',
      address: '200 Main Street',
      position: [-117.09, 33.51],
      geometry: null,
      apartmentBuilding: true,
      distinctUnits: 24,
    },
  ],
  estimatedTracts: 24,
  evidence: { apartmentBuilding: true, distinctUnits: 24 },
  reviewStatus: 'ready',
  withinBoundary: true,
};

function workspace(site: ApartmentSite = configuredSite): TerritoryWorkspace {
  const apartmentSites = [site];
  return {
    id: 'territory-1',
    churchName: 'Grace Church',
    name: 'Northside',
    originAddress: '100 Main Street',
    center: [-117.1, 33.5],
    radiusMiles: 2,
    boundaryShape: 'circle',
    import: {
      kind: 'proof',
      release: null,
      center: null,
      radiusMiles: null,
      completedAt: null,
      normalizerVersion: null,
      quality: null,
    },
    apartmentSites,
    apartmentComplexes: apartmentSites,
    segments: [],
    totals: { allSegments: 0, eligibleSegments: 0, allHomes: 0, eligibleHomes: 0 },
  };
}

function configuration(
  overrides: Partial<ApartmentSiteConfigurationInput> = {},
): ApartmentSiteConfigurationInput {
  return {
    id: configuredSite.id,
    name: configuredSite.name,
    address: configuredSite.address,
    addressConfirmed: configuredSite.addressConfirmed,
    tractCount: configuredSite.tractCount,
    accessStatus: configuredSite.accessStatus,
    groupingConfirmed: configuredSite.groupingConfirmed,
    includedInPackets: configuredSite.includedInPackets,
    ...overrides,
  };
}

test('complete apartment facts and inclusion produce an optimistic included workspace', () => {
  const previous = workspace({
    ...configuredSite,
    address: null,
    addressConfirmed: false,
    tractCount: null,
    accessStatus: 'unknown',
    includedInPackets: false,
    packetReady: false,
    reviewStatus: 'needs_review',
  });

  const optimistic = optimisticApartmentConfiguration(previous, configuration());

  assert.ok(optimistic);
  assert.equal(optimistic.apartmentSites[0]?.address, '200 Main Street');
  assert.equal(optimistic.apartmentSites[0]?.tractCount, 24);
  assert.equal(optimistic.apartmentSites[0]?.accessStatus, 'open');
  assert.equal(optimistic.apartmentSites[0]?.packetReady, true);
  assert.equal(optimistic.apartmentSites[0]?.includedInPackets, true);
  assert.equal(previous.apartmentSites[0]?.includedInPackets, false);
});

test('clearing a required fact turns optimistic apartment inclusion off', () => {
  const previous = workspace();

  const optimistic = optimisticApartmentConfiguration(
    previous,
    configuration({ tractCount: null, includedInPackets: true }),
  );

  assert.ok(optimistic);
  assert.equal(optimistic.apartmentSites[0]?.packetReady, false);
  assert.equal(optimistic.apartmentSites[0]?.includedInPackets, false);
  assert.equal(previous.apartmentSites[0]?.includedInPackets, true);
});

test('successful apartment mutation adopts the server workspace', () => {
  const previous = workspace();
  const serverWorkspace = workspace({
    ...configuredSite,
    address: '202 Main Street',
  });
  const input = configuration({ address: '202 Main Street' });

  const resolved = resolveApartmentMutation(
    previous,
    { kind: 'configuration', input },
    {
      status: 'success',
      value: serverWorkspace,
    },
  );

  assert.strictEqual(resolved.workspace, serverWorkspace);
  assert.equal(resolved.failure, null);
});

test('confirmed rejection restores the previous workspace and preserves configuration retry', () => {
  const previous = workspace();
  const input = configuration({ tractCount: 30 });
  const mutation = { kind: 'configuration' as const, input };

  const resolved = resolveApartmentMutation(previous, mutation, {
    status: 'rejected',
    message: 'Apartment changed on the server',
    recovery: 'retry',
  });

  assert.strictEqual(resolved.workspace, previous);
  assert.deepEqual(resolved.failure, {
    id: configuredSite.id,
    mutation,
    message: 'Apartment changed on the server',
    recovery: 'retry',
  });
  assert.strictEqual(resolved.failure?.mutation.input, input);
});

test('uncertain result restores the previous workspace and exposes reload recovery', () => {
  const previous = workspace();
  const input = configuration({ accessStatus: 'restricted' });

  const resolved = resolveApartmentMutation(
    previous,
    { kind: 'configuration', input },
    { status: 'uncertain', recovery: 'reload' },
  );

  assert.strictEqual(resolved.workspace, previous);
  assert.equal(resolved.failure?.id, configuredSite.id);
  assert.equal(resolved.failure?.mutation.kind, 'configuration');
  assert.strictEqual(resolved.failure?.mutation.input, input);
  assert.equal(resolved.failure?.recovery, 'reload');
  assert.match(resolved.failure?.message ?? '', /could not confirm/i);
});

test('membership rejection preserves mutation identity and retry recovery', () => {
  const previous = workspace();
  const input = { id: configuredSite.id, memberIds: ['building-1', 'building-2'] };

  const resolved = resolveApartmentMutation(
    previous,
    { kind: 'membership', input },
    {
      status: 'rejected',
      message: 'A building belongs to another site',
      recovery: 'retry',
    },
  );

  assert.strictEqual(resolved.workspace, previous);
  assert.equal(resolved.failure?.id, configuredSite.id);
  assert.equal(resolved.failure?.mutation.kind, 'membership');
  assert.strictEqual(resolved.failure?.mutation.input, input);
  assert.equal(resolved.failure?.recovery, 'retry');
  assert.equal(resolved.failure?.message, 'A building belongs to another site');
});
