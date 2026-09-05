export type Position = [number, number];

export type LineString = {
  type: 'LineString';
  coordinates: Position[];
};

export type Polygon = {
  type: 'Polygon';
  coordinates: Position[][];
};

export type BoundaryShape = 'circle' | 'square';

const EARTH_RADIUS_MILES = 3958.7613;
const EPSILON = 1e-10;

function positionsEqual(first: Position, second: Position): boolean {
  return first[0] === second[0] && first[1] === second[1];
}

export function closePolygon(points: Position[]): Polygon {
  const ring = points.map((point): Position => [...point]);
  if (ring.length > 0 && !positionsEqual(ring[0], ring.at(-1) as Position)) {
    ring.push([...ring[0]]);
  }
  return { type: 'Polygon', coordinates: [ring] };
}

function distanceMiles(first: Position, second: Position): number {
  const toRadians = Math.PI / 180;
  const latitudeDelta = (second[1] - first[1]) * toRadians;
  const longitudeDelta = (second[0] - first[0]) * toRadians;
  const firstLatitude = first[1] * toRadians;
  const secondLatitude = second[1] * toRadians;
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(haversine));
}

export function lineInsideCircle(line: LineString, center: Position, radiusMiles: number): boolean {
  return line.coordinates.every((point) => distanceMiles(point, center) <= radiusMiles + EPSILON);
}

export function circleBoundary(center: Position, radiusMiles: number, vertices = 32): Polygon {
  const angularDistance = radiusMiles / EARTH_RADIUS_MILES;
  const latitude = (center[1] * Math.PI) / 180;
  const longitude = (center[0] * Math.PI) / 180;
  const points: Position[] = [];

  for (let index = 0; index < vertices; index += 1) {
    const bearing = Math.PI / 2 + (index / vertices) * Math.PI * 2;
    const nextLatitude = Math.asin(
      Math.sin(latitude) * Math.cos(angularDistance) +
        Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearing),
    );
    const nextLongitude =
      longitude +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude),
        Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(nextLatitude),
      );
    points.push([(nextLongitude * 180) / Math.PI, (nextLatitude * 180) / Math.PI]);
  }
  return closePolygon(points);
}

export function territoryBoundary(
  center: Position,
  radiusMiles: number,
  shape: BoundaryShape,
): Polygon {
  if (shape === 'circle') {
    return circleBoundary(center, radiusMiles);
  }
  const angularDistance = radiusMiles / EARTH_RADIUS_MILES;
  const latitudeDelta = (angularDistance * 180) / Math.PI;
  const latitude = (center[1] * Math.PI) / 180;
  const longitudeDelta =
    Math.abs(center[1]) + latitudeDelta >= 90
      ? 180
      : (Math.asin(Math.sin(angularDistance) / Math.cos(latitude)) * 180) / Math.PI;
  const crossesAntimeridian = center[0] - longitudeDelta < -180 || center[0] + longitudeDelta > 180;
  const west = crossesAntimeridian ? -180 : center[0] - longitudeDelta;
  const east = crossesAntimeridian ? 180 : center[0] + longitudeDelta;
  const south = Math.max(-90, center[1] - latitudeDelta);
  const north = Math.min(90, center[1] + latitudeDelta);
  return closePolygon([
    [west, south],
    [east, south],
    [east, north],
    [west, north],
  ]);
}

export function lineInsideTerritoryBoundary(
  line: LineString,
  center: Position,
  radiusMiles: number,
  shape: BoundaryShape,
): boolean {
  if (shape === 'circle') {
    return lineInsideCircle(line, center, radiusMiles);
  }
  const [westSouth, eastSouth, eastNorth] = territoryBoundary(center, radiusMiles, 'square')
    .coordinates[0];
  return line.coordinates.every(
    ([longitude, latitude]) =>
      longitude >= westSouth[0] - EPSILON &&
      longitude <= eastSouth[0] + EPSILON &&
      latitude >= westSouth[1] - EPSILON &&
      latitude <= eastNorth[1] + EPSILON,
  );
}

export function pointInsideTerritoryBoundary(
  point: Position,
  center: Position,
  radiusMiles: number,
  shape: BoundaryShape,
): boolean {
  return lineInsideTerritoryBoundary(
    { type: 'LineString', coordinates: [point] },
    center,
    radiusMiles,
    shape,
  );
}
