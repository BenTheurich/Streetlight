import assert from 'node:assert/strict';
import test from 'node:test';
import {
  closePolygon,
  type LineString,
  lineInsideCircle,
  lineIntersectsPolygon,
  type Polygon,
  polygonIsSimple,
} from './territory-geometry.ts';

const insideLine: LineString = {
  type: 'LineString',
  coordinates: [
    [0, 0],
    [0, 0.01],
  ],
};

const crossingLine: LineString = {
  type: 'LineString',
  coordinates: [
    [0, 0],
    [0, 0.03],
  ],
};

const square: Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
      [-1, -1],
    ],
  ],
};

test('circle containment includes complete lines on or within the radius', () => {
  assert.equal(lineInsideCircle(insideLine, [0, 0], 1), true);
  assert.equal(
    lineInsideCircle(
      {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [0, 0.01447],
        ],
      },
      [0, 0],
      1,
    ),
    true,
  );
});

test('circle containment rejects a line that crosses the radius', () => {
  assert.equal(lineInsideCircle(crossingLine, [0, 0], 1), false);
});

test('polygon contact includes a line that only touches its boundary', () => {
  assert.equal(
    lineIntersectsPolygon(
      {
        type: 'LineString',
        coordinates: [
          [-2, 1],
          [-1, 1],
        ],
      },
      square,
    ),
    true,
  );
});

test('polygon intersection leaves an unrelated line alone', () => {
  assert.equal(
    lineIntersectsPolygon(
      {
        type: 'LineString',
        coordinates: [
          [2, 2],
          [3, 3],
        ],
      },
      square,
    ),
    false,
  );
});

test('polygon validation rejects a self-intersecting ring', () => {
  assert.equal(
    polygonIsSimple({
      type: 'Polygon',
      coordinates: [
        [
          [-1, -1],
          [1, 1],
          [-1, 1],
          [1, -1],
          [-1, -1],
        ],
      ],
    }),
    false,
  );
  assert.equal(polygonIsSimple(square), true);
});

test('closing a polygon adds one closing coordinate', () => {
  assert.deepEqual(
    closePolygon([
      [-1, -1],
      [1, -1],
      [1, 1],
    ]),
    {
      type: 'Polygon',
      coordinates: [
        [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, -1],
        ],
      ],
    },
  );
});
