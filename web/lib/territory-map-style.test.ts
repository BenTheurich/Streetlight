import assert from 'node:assert/strict';
import test from 'node:test';
import {
  apartmentAllowsDrawingPoint,
  apartmentMarkerColor,
  createApartmentSelection as createSelection,
  apartmentFocusZoom as focusZoom,
  mapMarkerStyle as markerStyle,
  apartmentOptionLabel as optionLabel,
  mapPinDataUrl as pinDataUrl,
  apartmentReviewOptions as reviewOptions,
  segmentMapAppearance,
  segmentStrokeWeight,
  segmentVisibleOnMap,
} from './territory-map-style.ts';

test('apartment markers follow packet inclusion after membership invalidation', () => {
  const membershipInvalidated = {
    groupingConfirmed: true,
    includedInPackets: false,
  };
  assert.equal(apartmentMarkerColor(membershipInvalidated), '#8f8a80');
  assert.equal(
    apartmentMarkerColor({ ...membershipInvalidated, includedInPackets: true }),
    '#123464',
  );
});

test('apartment options use packet inclusion and disambiguate anonymous complexes by road', () => {
  const segments = [
    {
      id: 'unnamed',
      streetName: 'Unnamed road',
      geometry: {
        coordinates: [
          [0.0001, 0],
          [0.0001, 1],
        ] as Array<[number, number]>,
      },
    },
    {
      id: 'main',
      streetName: 'Main Street',
      geometry: {
        coordinates: [
          [0, 0],
          [0, 1],
        ] as Array<[number, number]>,
      },
    },
    {
      id: 'oak',
      streetName: 'Oak Road',
      geometry: {
        coordinates: [
          [2, 0],
          [2, 1],
        ] as Array<[number, number]>,
      },
    },
  ];
  const apartments = [
    {
      id: 'ready-oak',
      name: 'Oak Apartments',
      address: '12 Oak Road',
      position: [2, 0.5] as [number, number],
      includedInPackets: true,
      members: [{ apartmentBuilding: true }],
    },
    {
      id: 'anonymous-b',
      name: null,
      address: null,
      position: [0.0002, 0.6] as [number, number],
      includedInPackets: false,
      members: [{ apartmentBuilding: true }],
    },
    {
      id: 'anonymous-a',
      name: null,
      address: null,
      position: [0.0001, 0.4] as [number, number],
      includedInPackets: false,
      members: [{ apartmentBuilding: true }],
    },
  ];

  const options = reviewOptions(apartments, segments, '');
  assert.deepEqual(
    options.map(({ apartment }) => apartment.id),
    ['anonymous-a', 'anonymous-b', 'ready-oak'],
  );
  assert.equal(options[0]?.nearbyStreet, 'Main Street');
  assert.equal(options[0]?.disambiguator, 'Building 1');
  assert.equal(options[1]?.disambiguator, 'Building 2');
  assert.equal(
    options[0]?.label,
    'Address unavailable near Main Street · Not included · Building 1',
  );
  assert.equal(
    options[1]?.label,
    'Address unavailable near Main Street · Not included · Building 2',
  );
  assert.deepEqual(
    reviewOptions(apartments, segments, 'oak').map(({ apartment }) => apartment.id),
    ['ready-oak'],
  );
});

test('church, packet, and apartment markers share one visual system', () => {
  assert.deepEqual(markerStyle, {
    fill: '#123464',
    outline: '#ffffff',
    outlineWidth: 2,
    radius: 12,
    selectedRadius: 15,
  });
  const church = decodeURIComponent(pinDataUrl('church'));
  const start = decodeURIComponent(pinDataUrl('start'));
  for (const pin of [church, start]) {
    assert.match(pin, /fill="#123464"/);
    assert.match(pin, /stroke="#ffffff"/);
  }
  assert.match(church, /M20\.8 11\.5h2\.4v4\.7H27v2\.4h-3\.8v7\.9h-2\.4v-7\.9H17v-2\.4h3\.8Z/);
  assert.doesNotMatch(church, /<circle/);
  assert.match(start, /<circle cx="22" cy="17\.5" r="4\.6" fill="#ffffff"/);
});

test('apartment interaction keeps selection origin, camera threshold, and drawing isolation explicit', () => {
  assert.equal(
    optionLabel({
      address: null,
      name: null,
      includedInPackets: false,
      members: [{ apartmentBuilding: true }],
    }),
    'Address unavailable · Not included',
  );
  assert.equal(
    optionLabel({
      address: '1 Main Street',
      name: null,
      includedInPackets: true,
      members: [{ apartmentBuilding: true }],
    }),
    '1 Main Street · Included',
  );
  assert.equal(focusZoom('map', 11), null);
  assert.equal(focusZoom('selector', 11), 16);
  assert.equal(focusZoom('selector', 17.25), 17.25);
  assert.deepEqual(createSelection('apartment-one', 'map'), {
    id: 'apartment-one',
    source: 'map',
  });
  assert.deepEqual(createSelection('apartment-one', 'selector'), {
    id: 'apartment-one',
    source: 'selector',
  });
  assert.equal(apartmentAllowsDrawingPoint(false), true);
  assert.equal(apartmentAllowsDrawingPoint(true), false);
});

test('segment strokes scale from two to five pixels', () => {
  assert.equal(segmentStrokeWeight(10), 2);
  assert.equal(segmentStrokeWeight(12), 2);
  assert.equal(segmentStrokeWeight(13), 3);
  assert.equal(segmentStrokeWeight(14), 4);
  assert.equal(segmentStrokeWeight(17), 5);
});

test('segment map appearance preserves status styling beneath selection', () => {
  const active = {
    id: 'segment:one',
    roadGroupId: 'road:shared',
    active: true,
    eligible: true,
    manuallyExcluded: false,
  };
  assert.deepEqual(segmentMapAppearance(active, false), {
    strokeColor: '#596675',
    strokeOpacity: 0.8,
    weightOffset: 0,
    selected: false,
    selectable: true,
    zIndex: 3,
  });
  assert.deepEqual(segmentMapAppearance(active, true), {
    strokeColor: '#596675',
    strokeOpacity: 0.95,
    weightOffset: 0,
    selected: true,
    selectable: true,
    zIndex: 4,
  });
  assert.deepEqual(
    segmentMapAppearance({ ...active, eligible: false, manuallyExcluded: true }, false),
    {
      strokeColor: '#aaa7a0',
      strokeOpacity: 0.45,
      weightOffset: -1,
      selected: false,
      selectable: true,
      zIndex: 5,
    },
  );
  assert.deepEqual(
    segmentMapAppearance(
      { ...active, active: false, eligible: false, manuallyExcluded: true },
      true,
    ),
    {
      strokeColor: '#aaa7a0',
      strokeOpacity: 0.75,
      weightOffset: -1,
      selected: true,
      selectable: true,
      zIndex: 5,
    },
  );
  assert.deepEqual(segmentMapAppearance({ ...active, active: false, eligible: false }, false), {
    strokeColor: '#6f8794',
    strokeOpacity: 0.48,
    weightOffset: -1,
    selected: false,
    selectable: true,
    zIndex: 1,
  });
  assert.equal(
    segmentMapAppearance({ ...active, eligible: false, manuallyExcluded: false }, false).selectable,
    false,
  );
});

test('map visibility omits every segment outside the boundary before applying hidden-road controls', () => {
  const active = { active: true, withinBoundary: true, manuallyExcluded: false };
  assert.equal(segmentVisibleOnMap(active, false), true);
  assert.equal(segmentVisibleOnMap({ ...active, withinBoundary: false }, true), false);
  assert.equal(segmentVisibleOnMap({ ...active, active: false }, false), false);
  assert.equal(segmentVisibleOnMap({ ...active, active: false }, true), true);
  assert.equal(
    segmentVisibleOnMap({ active: false, withinBoundary: false, manuallyExcluded: true }, true),
    false,
  );
});
