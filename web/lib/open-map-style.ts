import type { MapLabData } from './database.ts';
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

export function packetMapView(packet: DownloadPacket): {
  center: Position;
  zoom: number;
} {
  const points = [
    packet.start.position,
    ...packet.segments.flatMap(({ geometry }) => geometry.coordinates),
  ];
  if (points.length === 1) return { center: [...packet.start.position], zoom: 18 };
  const xs = points.map(([longitude]) => worldX(longitude));
  const ys = points.map(([, latitude]) => worldY(latitude));
  const west = Math.min(...xs);
  const east = Math.max(...xs);
  const north = Math.min(...ys);
  const south = Math.max(...ys);
  const paddedWidth = Math.max((east - west) * 1.28, Number.EPSILON);
  const paddedHeight = Math.max((south - north) * 1.28, Number.EPSILON);
  const zoom = Math.max(
    0,
    Math.min(
      19,
      Math.floor(Math.log2(Math.min(1280 / (256 * paddedWidth), 1280 / (256 * paddedHeight)))),
    ),
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

function insertBefore(style: OpenMapStyle, beforeId: string, layers: StyleLayer[]): void {
  const index = style.layers.findIndex(({ id }) => id === beforeId);
  style.layers.splice(index < 0 ? style.layers.length : index, 0, ...layers);
}

function addBuildingLayer(style: OpenMapStyle, buildings: PacketMapGeneration['buildings']): void {
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
  insertBefore(style, 'highway_path', [
    {
      id: 'streetlight-buildings',
      type: 'fill',
      source: 'streetlightBuildings',
      paint: {
        'fill-color': '#e6e9ed',
        'fill-opacity': 0.98,
        'fill-outline-color': '#d2d7dc',
      },
    },
  ]);
}

export function buildOpenMapStyle(
  base: OpenMapStyle,
  packet: DownloadPacket,
  generation: PacketMapGeneration,
  zoom: number,
): OpenMapStyle {
  const style = structuredClone(base);
  addBuildingLayer(style, generation.buildings);
  style.sources.streetlightRoute = {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: packetRouteFeatures(packet, generation, zoom) },
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

export function buildOpenLabStyle(
  base: OpenMapStyle,
  data: MapLabData,
  satellite = false,
): OpenMapStyle {
  const style: OpenMapStyle = satellite
    ? {
        version: 8,
        sources: {
          googleSatellite: {
            type: 'raster',
            tiles: ['/api/founder/map-lab/satellite/{z}/{x}/{y}'],
            tileSize: 256,
          },
        },
        layers: [
          {
            id: 'satellite',
            type: 'raster',
            source: 'googleSatellite',
            layout: { visibility: 'none' },
          },
        ],
      }
    : structuredClone(base);
  if (!satellite) addBuildingLayer(style, data.buildings);
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
        'line-width': routeWidthExpression(),
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
