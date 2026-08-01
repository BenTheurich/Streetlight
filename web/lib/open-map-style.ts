import type { OpenMapData } from './database.ts';
import type { DownloadPacket, PacketMapGeneration } from './packet-finalization.ts';
import { endpointMeetsInterior } from './packet-selection.ts';
import type { LineString, Position } from './territory-geometry.ts';
import { coverageColors } from './territory-map-style.ts';

const ZOOM_STOPS = [14, 18, 20] as const;
const WIDTHS = {
  minor: [8, 31, 42],
  service: [3, 12, 18],
  track: [2, 8, 12],
  path: [2, 6, 8],
  major: [11, 39, 52],
  motorway: [13, 40, 52],
} as const;
const ROUTE_CLASSES: Array<[string | string[], keyof typeof WIDTHS]> = [
  [['residential', 'living_street', 'unclassified'], 'minor'],
  ['service', 'service'],
  ['track', 'track'],
  [['primary', 'secondary', 'tertiary', 'trunk'], 'major'],
  ['motorway', 'motorway'],
];

type StyleLayer = {
  id: string;
  type: string;
  source?: string;
  layout?: Record<string, unknown>;
  paint?: Record<string, unknown>;
  [key: string]: unknown;
};

export type OpenMapStyle = {
  version: number;
  sources: Record<string, unknown>;
  layers: StyleLayer[];
  [key: string]: unknown;
};

type RouteFeature = {
  type: 'Feature';
  geometry: LineString;
  properties: {
    streetName: string;
    roadClass: string;
    startTreatment: EndpointTreatment;
    endTreatment: EndpointTreatment;
  };
};

type RouteFallbackLabelFeature = {
  type: 'Feature';
  geometry: LineString;
  properties: { streetName: string; streetNameKey: string };
};

type EndpointTreatment = 'selected_join' | 'network_continuation' | 'network_end' | 'ambiguous';

function widthFamily(roadClass: string): keyof typeof WIDTHS {
  return (
    ROUTE_CLASSES.find(([labels]) =>
      Array.isArray(labels) ? labels.includes(roadClass) : labels === roadClass,
    )?.[1] ?? 'minor'
  );
}

export function roadWidthAtZoom(roadClass: string, zoom: number): number {
  const values = WIDTHS[widthFamily(roadClass)];
  if (zoom <= ZOOM_STOPS[0]) return values[0];
  if (zoom >= ZOOM_STOPS[2]) return values[2];
  const upperIndex = ZOOM_STOPS.findIndex((stop) => stop >= zoom);
  const lowerZoom = ZOOM_STOPS[upperIndex - 1];
  const upperZoom = ZOOM_STOPS[upperIndex];
  const amount = (1.4 ** (zoom - lowerZoom) - 1) / (1.4 ** (upperZoom - lowerZoom) - 1);
  return values[upperIndex - 1] + (values[upperIndex] - values[upperIndex - 1]) * amount;
}

function routeWidthExpression(): unknown[] {
  return [
    'interpolate',
    ['exponential', 1.4],
    ['zoom'],
    ...ZOOM_STOPS.flatMap((zoom, index) => [
      zoom,
      [
        'match',
        ['get', 'roadClass'],
        ...ROUTE_CLASSES.flatMap(([labels, family]) => [labels, WIDTHS[family][index]]),
        WIDTHS.minor[index],
      ],
    ]),
  ];
}

function coverageWidthExpression(): unknown[] {
  return ['interpolate', ['linear'], ['zoom'], 11, 2, 14, 5];
}

const INTERACTIVE_ROAD_STOPS: Array<[string, unknown[]]> = [
  ['highway_path', [11, 0.35, 13, 0.65, 14, 0.9, 16, 2.5]],
  [
    'highway_minor',
    [
      11,
      ['match', ['get', 'class'], 'minor', 0.5, 'service', 0.3, 'track', 0.2, 0.5],
      13,
      ['match', ['get', 'class'], 'minor', 1.25, 'service', 0.6, 'track', 0.4, 1.25],
      14,
      ['match', ['get', 'class'], 'minor', 2, 'service', 0.9, 'track', 0.6, 2],
      16,
      ['match', ['get', 'class'], 'minor', 9, 'service', 4, 'track', 3, 9],
    ],
  ],
  ['highway_major_inner', [11, 2, 13, 4, 14, 5, 16, 15]],
  ['highway_motorway_inner', [11, 4, 13, 6, 14, 8, 16, 18]],
];

function styleOpenRoads(style: OpenMapStyle): void {
  for (const [id, stops] of INTERACTIVE_ROAD_STOPS) {
    const paint = style.layers.find((layer) => layer.id === id)?.paint;
    const width = paint?.['line-width'];
    if (!paint || !Array.isArray(width) || width[0] !== 'interpolate') continue;
    paint['line-width'] = [...width.slice(0, 3), ...stops, ...width.slice(5)];
  }
  for (const id of ['highway-name-minor', 'highway-name-major']) {
    const layer = style.layers.find((candidate) => candidate.id === id);
    if (!layer) continue;
    if (id === 'highway-name-minor') layer.minzoom = 14;
    layer.layout = {
      ...layer.layout,
      'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 16, 12, 18, 17, 20, 19],
    };
    layer.paint = {
      ...layer.paint,
      'text-color': ['step', ['zoom'], '#5f6f7b', 17, '#ffffff'],
      'text-halo-color': ['step', ['zoom'], 'rgba(255, 255, 255, 0.94)', 17, '#687985'],
      'text-halo-width': ['step', ['zoom'], 1.25, 17, 1],
    };
  }
}

function worldX(longitude: number): number {
  return (longitude + 180) / 360;
}

function worldY(latitude: number): number {
  const radians = (latitude * Math.PI) / 180;
  return (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2;
}

function longitudeAtWorldX(value: number): number {
  return value * 360 - 180;
}

function latitudeAtWorldY(value: number): number {
  return (Math.atan(Math.sinh(Math.PI * (1 - 2 * value))) * 180) / Math.PI;
}

export function packetMapView(
  packet: DownloadPacket,
  start: Position = packet.start.position,
): {
  center: Position;
  zoom: number;
} {
  const points = [start, ...packet.segments.flatMap(({ geometry }) => geometry.coordinates)];
  if (points.length === 1) return { center: [...packet.start.position], zoom: 18 };
  const xs = points.map(([longitude]) => worldX(longitude));
  const ys = points.map(([, latitude]) => worldY(latitude));
  const west = Math.min(...xs);
  const east = Math.max(...xs);
  const north = Math.min(...ys);
  const south = Math.max(...ys);
  const paddedWidth = Math.max((east - west) * 1.2, Number.EPSILON);
  const paddedHeight = Math.max((south - north) * 1.2, Number.EPSILON);
  const zoom = Math.max(
    0,
    Math.min(19, Math.log2(Math.min(1280 / (512 * paddedWidth), 1280 / (512 * paddedHeight)))),
  );
  return {
    center: [longitudeAtWorldX((west + east) / 2), latitudeAtWorldY((north + south) / 2)],
    zoom,
  };
}

function endpointKey([longitude, latitude]: Position): string {
  return `${longitude.toFixed(7)},${latitude.toFixed(7)}`;
}

function vector(start: Position, end: Position): Position {
  return [(end[0] - start[0]) * Math.cos(((start[1] + end[1]) * Math.PI) / 360), end[1] - start[1]];
}

function distanceMeters(start: Position, end: Position): number {
  return Math.hypot(...vector(start, end)) * 111_320;
}

function streetNameKey(value: string): string {
  const words = value.trim().toUpperCase().split(/\s+/);
  const directions: Record<string, string> = {
    N: 'NORTH',
    S: 'SOUTH',
    E: 'EAST',
    W: 'WEST',
    NE: 'NORTHEAST',
    NW: 'NORTHWEST',
    SE: 'SOUTHEAST',
    SW: 'SOUTHWEST',
  };
  const suffixes: Record<string, string> = {
    AVE: 'AVENUE',
    BLVD: 'BOULEVARD',
    CIR: 'CIRCLE',
    CT: 'COURT',
    CV: 'COVE',
    DR: 'DRIVE',
    HTS: 'HEIGHTS',
    HWY: 'HIGHWAY',
    LN: 'LANE',
    PKWY: 'PARKWAY',
    PL: 'PLACE',
    RD: 'ROAD',
    ST: 'STREET',
    TER: 'TERRACE',
    TRL: 'TRAIL',
  };
  words[0] = directions[words[0]] ?? words[0];
  const last = words.length - 1;
  words[last] = suffixes[words[last]] ?? words[last];
  return words.join(' ');
}

function trimTerminal(coordinates: Position[], atStart: boolean, meters: number): Position[] {
  const result = coordinates.map((coordinate): Position => [...coordinate]);
  const terminalIndex = atStart ? 0 : result.length - 1;
  const neighborIndex = atStart ? 1 : result.length - 2;
  const terminal = result[terminalIndex];
  const neighbor = result[neighborIndex];
  const length = distanceMeters(terminal, neighbor);
  if (length === 0) return result;
  const ratio = Math.min(meters / length, 0.49);
  result[terminalIndex] = [
    terminal[0] + (neighbor[0] - terminal[0]) * ratio,
    terminal[1] + (neighbor[1] - terminal[1]) * ratio,
  ];
  return result;
}

export function packetRouteFeatures(
  packet: DownloadPacket,
  generation: PacketMapGeneration,
  zoom: number,
): RouteFeature[] {
  const selectedEndpoints = new Map<string, string[]>();
  for (const segment of packet.segments) {
    for (const endpoint of [
      segment.geometry.coordinates[0],
      segment.geometry.coordinates.at(-1) as Position,
    ]) {
      const key = endpointKey(endpoint);
      selectedEndpoints.set(key, [...(selectedEndpoints.get(key) ?? []), segment.id]);
    }
  }
  const treatment = (
    segment: DownloadPacket['segments'][number],
    atStart: boolean,
  ): EndpointTreatment => {
    const coordinates = segment.geometry.coordinates;
    const endpoint = atStart ? coordinates[0] : (coordinates.at(-1) as Position);
    if ((selectedEndpoints.get(endpointKey(endpoint)) ?? []).length > 1) {
      return 'selected_join';
    }
    if (!generation.networkSegments) return 'ambiguous';
    const neighbor = atStart ? coordinates[1] : coordinates[coordinates.length - 2];
    const direction = vector(endpoint, neighbor);
    const continued = generation.networkSegments.some((candidate) => {
      if (candidate.id === segment.id) return false;
      const candidateCoordinates = candidate.geometry.coordinates;
      return (
        endpointKey(candidateCoordinates[0]) === endpointKey(endpoint) ||
        endpointKey(candidateCoordinates.at(-1) as Position) === endpointKey(endpoint) ||
        endpointMeetsInterior({ point: endpoint, direction }, candidate.geometry)
      );
    });
    return continued ? 'network_continuation' : 'network_end';
  };

  return packet.segments.map((segment) => {
    const sourceCoordinates = segment.geometry.coordinates;
    const startTreatment = treatment(segment, true);
    const endTreatment = treatment(segment, false);
    let coordinates = sourceCoordinates;
    for (const [atStart, endpointTreatment] of [
      [true, startTreatment],
      [false, endTreatment],
    ] as const) {
      if (endpointTreatment !== 'network_continuation') continue;
      const endpoint = atStart
        ? sourceCoordinates[0]
        : sourceCoordinates[sourceCoordinates.length - 1];
      const metersPerPixel =
        (156543.03392804097 * Math.cos((endpoint[1] * Math.PI) / 180)) / 2 ** zoom;
      coordinates = trimTerminal(
        coordinates,
        atStart,
        (roadWidthAtZoom(segment.roadClass, zoom) * metersPerPixel) / 2,
      );
    }
    return {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates },
      properties: {
        streetName: segment.streetName,
        roadClass: segment.roadClass,
        startTreatment,
        endTreatment,
      },
    };
  });
}

function packetRouteFallbackLabelFeatures(features: RouteFeature[]): RouteFallbackLabelFeature[] {
  const longest = new Map<string, { feature: RouteFallbackLabelFeature; length: number }>();
  for (const feature of features) {
    const key = streetNameKey(feature.properties.streetName);
    if (!key) continue;
    const coordinates = feature.geometry.coordinates;
    const length = coordinates
      .slice(1)
      .reduce(
        (total, coordinate, index) => total + distanceMeters(coordinates[index], coordinate),
        0,
      );
    if (length <= (longest.get(key)?.length ?? -1)) continue;
    longest.set(key, {
      feature: {
        type: 'Feature',
        geometry: feature.geometry,
        properties: {
          streetName: feature.properties.streetName.trim().replace(/\s+/g, ' '),
          streetNameKey: key,
        },
      },
      length,
    });
  }
  return [...longest.values()].map(({ feature }) => feature);
}

function insertBefore(style: OpenMapStyle, beforeId: string, layers: StyleLayer[]): void {
  const index = style.layers.findIndex(({ id }) => id === beforeId);
  style.layers.splice(index < 0 ? style.layers.length : index, 0, ...layers);
}

function addBuildingLayer(
  style: OpenMapStyle,
  buildings: PacketMapGeneration['buildings'],
  minzoom?: number,
): void {
  style.sources.streetlightBuildings = {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: buildings.map((building) => ({
        type: 'Feature',
        geometry: building.geometry,
        properties: { source: building.source, sourceId: building.sourceId },
      })),
    },
  };
  const layer: StyleLayer = {
    id: 'streetlight-buildings',
    type: 'fill',
    source: 'streetlightBuildings',
    paint: {
      'fill-color': '#e6e9ed',
      'fill-opacity': 0.98,
      'fill-outline-color': '#d2d7dc',
    },
  };
  if (minzoom !== undefined) layer.minzoom = minzoom;
  insertBefore(style, 'highway_path', [layer]);
}

type BuildingPolygon = Position[][];

function buildingPolygons(building: OpenMapData['buildings'][number]): BuildingPolygon[] {
  return building.geometry.type === 'Polygon'
    ? [building.geometry.coordinates]
    : building.geometry.coordinates;
}

function pointInRing([longitude, latitude]: Position, ring: Position[]): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const start = ring[previous];
    const end = ring[index];
    if (
      end[1] > latitude !== start[1] > latitude &&
      longitude < ((start[0] - end[0]) * (latitude - end[1])) / (start[1] - end[1]) + end[0]
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInBuilding(point: Position, polygon: BuildingPolygon): boolean {
  return (
    pointInRing(point, polygon[0] ?? []) &&
    !polygon.slice(1).some((ring) => pointInRing(point, ring))
  );
}

function pointToSegmentDistanceMeters(point: Position, start: Position, end: Position): number {
  const scale = Math.cos(((point[1] + start[1] + end[1]) * Math.PI) / 540);
  const x = (point[0] - start[0]) * scale;
  const y = point[1] - start[1];
  const dx = (end[0] - start[0]) * scale;
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  const amount =
    lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, (x * dx + y * dy) / lengthSquared));
  return Math.hypot(x - amount * dx, y - amount * dy) * 111_320;
}

function distanceToBuilding(
  point: Position,
  building: OpenMapData['buildings'][number],
): { distance: number; polygon: BuildingPolygon } | null {
  let nearest: { distance: number; polygon: BuildingPolygon } | null = null;
  for (const polygon of buildingPolygons(building)) {
    if (pointInBuilding(point, polygon)) return { distance: 0, polygon };
    for (const ring of polygon) {
      for (let index = 0; index < ring.length; index += 1) {
        const distance = pointToSegmentDistanceMeters(
          point,
          ring[index],
          ring[(index + 1) % ring.length],
        );
        if (!nearest || distance < nearest.distance) nearest = { distance, polygon };
      }
    }
  }
  return nearest;
}

function buildingLabelPosition(polygon: BuildingPolygon, fallback: Position): Position {
  const ring = polygon[0] ?? [];
  if (ring.length < 3) return fallback;
  const origin = ring[0];
  let twiceArea = 0;
  let longitude = 0;
  let latitude = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const start = ring[index];
    const end = ring[(index + 1) % ring.length];
    const startX = start[0] - origin[0];
    const startY = start[1] - origin[1];
    const endX = end[0] - origin[0];
    const endY = end[1] - origin[1];
    const cross = startX * endY - endX * startY;
    twiceArea += cross;
    longitude += (startX + endX) * cross;
    latitude += (startY + endY) * cross;
  }
  if (Math.abs(twiceArea) < 1e-20) return fallback;
  const center: Position = [
    origin[0] + longitude / (3 * twiceArea),
    origin[1] + latitude / (3 * twiceArea),
  ];
  return pointInBuilding(center, polygon) ? center : fallback;
}

export function positionedHouseNumbers(
  data: Pick<OpenMapData, 'buildings' | 'houseNumbers'>,
): OpenMapData['houseNumbers'] {
  const gridSize = 0.001;
  const houseNumberGrid = new Map<string, number[]>();
  data.houseNumbers.forEach(({ position }, index) => {
    const key = `${Math.floor(position[0] / gridSize)}:${Math.floor(position[1] / gridSize)}`;
    houseNumberGrid.set(key, [...(houseNumberGrid.get(key) ?? []), index]);
  });
  const femaMatches = new Map<number, BuildingPolygon>();
  for (const building of data.buildings) {
    if (building.source !== 'fema') continue;
    if (building.address) {
      const candidateIndexes = data.houseNumbers.flatMap((houseNumber, index) =>
        houseNumber.number === building.address?.number &&
        houseNumber.street.trim().toUpperCase() === building.address.street.trim().toUpperCase()
          ? [index]
          : [],
      );
      const match =
        candidateIndexes.length === 1
          ? distanceToBuilding(data.houseNumbers[candidateIndexes[0]].position, building)
          : null;
      if (match) femaMatches.set(candidateIndexes[0], match.polygon);
      continue;
    }
    if (!building.fema) continue;
    const fema = building.fema;
    const coordinates = buildingPolygons(building).flat(2);
    if (coordinates.length === 0) continue;
    const longitudes = coordinates.map(([longitude]) => longitude);
    const latitudes = coordinates.map(([, latitude]) => latitude);
    const latitudeMargin = (fema.distanceMeters + 0.01) / 111_320;
    const latitude = latitudes.reduce((total, value) => total + value, 0) / latitudes.length;
    const longitudeMargin = latitudeMargin / Math.max(Math.cos((latitude * Math.PI) / 180), 0.01);
    const candidateIndexes = new Set<number>();
    for (
      let longitudeCell = Math.floor((Math.min(...longitudes) - longitudeMargin) / gridSize);
      longitudeCell <= Math.floor((Math.max(...longitudes) + longitudeMargin) / gridSize);
      longitudeCell += 1
    ) {
      for (
        let latitudeCell = Math.floor((Math.min(...latitudes) - latitudeMargin) / gridSize);
        latitudeCell <= Math.floor((Math.max(...latitudes) + latitudeMargin) / gridSize);
        latitudeCell += 1
      ) {
        for (const index of houseNumberGrid.get(`${longitudeCell}:${latitudeCell}`) ?? []) {
          candidateIndexes.add(index);
        }
      }
    }
    const candidates = [...candidateIndexes]
      .map((index) => ({
        index,
        match: distanceToBuilding(data.houseNumbers[index].position, building),
      }))
      .filter(
        (
          candidate,
        ): candidate is {
          index: number;
          match: { distance: number; polygon: BuildingPolygon };
        } =>
          candidate.match !== null &&
          Math.abs(candidate.match.distance - fema.distanceMeters) <= 0.01,
      );
    if (candidates.length === 1) {
      femaMatches.set(candidates[0].index, candidates[0].match.polygon);
    }
  }

  const grid = new Map<string, Array<{ buildingIndex: number; polygon: BuildingPolygon }>>();
  data.buildings.forEach((building, buildingIndex) => {
    if (building.source === 'fema') return;
    for (const polygon of buildingPolygons(building)) {
      const ring = polygon[0] ?? [];
      if (ring.length < 3) continue;
      const longitudeCells = ring.map(([longitude]) => Math.floor(longitude / gridSize));
      const latitudeCells = ring.map(([, latitude]) => Math.floor(latitude / gridSize));
      for (
        let longitudeCell = Math.min(...longitudeCells);
        longitudeCell <= Math.max(...longitudeCells);
        longitudeCell += 1
      ) {
        for (
          let latitudeCell = Math.min(...latitudeCells);
          latitudeCell <= Math.max(...latitudeCells);
          latitudeCell += 1
        ) {
          const key = `${longitudeCell}:${latitudeCell}`;
          const candidates = grid.get(key) ?? [];
          candidates.push({ buildingIndex, polygon });
          grid.set(key, candidates);
        }
      }
    }
  });

  const candidatesByAddress = data.houseNumbers.map(({ position }) => {
    const longitudeCell = Math.floor(position[0] / gridSize);
    const latitudeCell = Math.floor(position[1] / gridSize);
    const candidates = (grid.get(`${longitudeCell}:${latitudeCell}`) ?? []).filter(({ polygon }) =>
      pointInBuilding(position, polygon),
    );
    const buildingIndexes = new Set(candidates.map(({ buildingIndex }) => buildingIndex));
    if (buildingIndexes.size === 1) return [{ ...candidates[0], distance: 0 }];
    if (buildingIndexes.size > 1) return [];

    for (let longitude = longitudeCell - 1; longitude <= longitudeCell + 1; longitude += 1) {
      for (let latitude = latitudeCell - 1; latitude <= latitudeCell + 1; latitude += 1) {
        for (const { buildingIndex } of grid.get(`${longitude}:${latitude}`) ?? []) {
          buildingIndexes.add(buildingIndex);
        }
      }
    }
    const nearest = [...buildingIndexes]
      .map((buildingIndex) => ({
        buildingIndex,
        match: distanceToBuilding(position, data.buildings[buildingIndex]),
      }))
      .filter(
        (
          candidate,
        ): candidate is {
          buildingIndex: number;
          match: { distance: number; polygon: BuildingPolygon };
        } => candidate.match !== null,
      )
      .sort(
        (left, right) =>
          left.match.distance - right.match.distance || left.buildingIndex - right.buildingIndex,
      )
      .map(({ buildingIndex, match }) => ({ buildingIndex, ...match }));
    return nearest;
  });
  const matches = candidatesByAddress.map(([nearest, runnerUp]) =>
    nearest?.distance <= 10 && (!runnerUp || runnerUp.distance - nearest.distance >= 3)
      ? nearest
      : null,
  );
  const rows = new Map<string, number[]>();
  data.houseNumbers.forEach((houseNumber, index) => {
    const number = Number.parseInt(houseNumber.number, 10);
    const street = houseNumber.street.trim().toUpperCase();
    if (!street || !Number.isSafeInteger(number)) return;
    const key = `${street}:${Math.abs(number) % 2}`;
    rows.set(key, [...(rows.get(key) ?? []), index]);
  });
  for (const row of rows.values()) {
    if (row.length < 3) continue;
    const claims = new Map<number, number>();
    for (const index of row) {
      const nearest = candidatesByAddress[index][0];
      if (nearest?.distance <= 10) {
        claims.set(nearest.buildingIndex, (claims.get(nearest.buildingIndex) ?? 0) + 1);
      }
    }
    for (const index of row) {
      const nearest = candidatesByAddress[index][0];
      if (!matches[index] && nearest?.distance <= 10 && claims.get(nearest.buildingIndex) === 1) {
        matches[index] = nearest;
      }
    }
  }
  const addressCounts = new Map<number, number>();
  for (const match of matches) {
    if (match)
      addressCounts.set(match.buildingIndex, (addressCounts.get(match.buildingIndex) ?? 0) + 1);
  }
  return data.houseNumbers.map((houseNumber, index) => {
    const femaPolygon = femaMatches.get(index);
    if (femaPolygon) {
      return {
        ...houseNumber,
        position: buildingLabelPosition(femaPolygon, houseNumber.position),
      };
    }
    const match = matches[index];
    return match && addressCounts.get(match.buildingIndex) === 1
      ? { ...houseNumber, position: buildingLabelPosition(match.polygon, houseNumber.position) }
      : houseNumber;
  });
}

export function packetStartDisplay(
  packet: DownloadPacket,
  generation: PacketMapGeneration,
): { number: string; position: Position } {
  const index = generation.houseNumbers.findIndex(
    ({ position }) => endpointKey(position) === endpointKey(packet.start.position),
  );
  if (index < 0) {
    return {
      number: packet.start.address.trim().split(/\s+/, 1)[0] ?? '',
      position: packet.start.position,
    };
  }
  return positionedHouseNumbers(generation)[index];
}

export function buildOpenMapStyle(
  base: OpenMapStyle,
  packet: DownloadPacket,
  generation: PacketMapGeneration,
  zoom: number,
): OpenMapStyle {
  const style = structuredClone(base);
  styleOpenRoads(style);
  addBuildingLayer(style, generation.buildings);
  const routeFeatures = packetRouteFeatures(packet, generation, zoom);
  style.sources.streetlightRoute = {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: routeFeatures },
  };
  style.sources.streetlightRouteFallbackLabels = {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: packetRouteFallbackLabelFeatures(routeFeatures),
    },
  };
  insertBefore(style, 'highway-name-minor', [
    {
      id: 'streetlight-route',
      type: 'line',
      source: 'streetlightRoute',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#ef6c3c',
        'line-opacity': 0.96,
        'line-width': routeWidthExpression(),
      },
    },
  ]);
  return style;
}

export function buildWorkspaceMapStyle(
  base: OpenMapStyle,
  data: OpenMapData,
  overlay = false,
): OpenMapStyle {
  const style: OpenMapStyle = overlay
    ? { version: 8, glyphs: base.glyphs, sources: {}, layers: [] }
    : structuredClone(base);
  if (!overlay) {
    styleOpenRoads(style);
    addBuildingLayer(style, data.buildings, 16);
    style.sources.streetlightHouseNumbers = {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: positionedHouseNumbers(data).map(({ number, position }) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: position },
          properties: { number },
        })),
      },
    };
  }
  style.sources.streetlightCoverage = {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: data.segments.map((segment) => ({
        type: 'Feature',
        geometry: segment.geometry,
        properties: {
          id: segment.id,
          roadClass: segment.roadClass,
          color: segment.eligible ? coverageColors[segment.coverageClass] : coverageColors.gray,
          opacity: segment.eligible ? 0.68 : 0.42,
        },
      })),
    },
  };
  style.sources.streetlightBoundary = {
    type: 'geojson',
    data: { type: 'Feature', properties: {}, geometry: data.boundary },
  };
  style.sources.streetlightApartments = {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: data.apartmentComplexes.map((apartment) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: apartment.position },
        properties: {
          label: 'A',
          color:
            apartment.reviewStatus === 'ready'
              ? coverageColors[apartment.coverageClass]
              : apartment.reviewStatus === 'needs_review'
                ? '#b97916'
                : coverageColors.gray,
        },
      })),
    },
  };
  insertBefore(style, 'highway-name-minor', [
    ...(!overlay
      ? [
          {
            id: 'streetlight-house-numbers',
            type: 'symbol',
            source: 'streetlightHouseNumbers',
            minzoom: 18,
            layout: {
              'text-field': ['get', 'number'],
              'text-size': 10,
              'text-font': ['Noto Sans Bold'],
              'text-allow-overlap': false,
            },
            paint: {
              'text-color': '#7b8794',
              'text-halo-color': 'rgba(255, 255, 255, 0.72)',
              'text-halo-width': 0.5,
            },
          },
        ]
      : []),
    {
      id: 'streetlight-boundary',
      type: 'line',
      source: 'streetlightBoundary',
      paint: {
        'line-color': '#0f7055',
        'line-opacity': 0.72,
        'line-width': 2,
        'line-dasharray': [3, 2],
      },
    },
    {
      id: 'streetlight-coverage',
      type: 'line',
      source: 'streetlightCoverage',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-opacity': ['get', 'opacity'],
        'line-width': coverageWidthExpression(),
      },
    },
    {
      id: 'streetlight-apartments',
      type: 'circle',
      source: 'streetlightApartments',
      paint: {
        'circle-color': ['get', 'color'],
        'circle-radius': 10,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
      },
    },
    {
      id: 'streetlight-apartment-labels',
      type: 'symbol',
      source: 'streetlightApartments',
      layout: {
        'text-field': ['get', 'label'],
        'text-size': 11,
        'text-font': ['Noto Sans Bold'],
      },
      paint: { 'text-color': '#ffffff' },
    },
  ]);
  return style;
}
