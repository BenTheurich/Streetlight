import {
  type CoverageRoad,
  type CoverageWorkspace,
  type CoverageWorkspaceApartment,
  type CoverageWorkspaceSegment,
  coverageRoadForSegment,
  coverageRoads,
} from './coverage.ts';
import type { StreetlightMapType } from './google-maps-browser.ts';
import {
  type CoverageSelectionSource,
  coverageSelectionCameraOptions,
  positionBounds,
  segmentSelectionBounds,
} from './map-camera.ts';
import type { OpenMapData } from './open-map-data.ts';
import { type OutreachProgressPeriod, outreachProgressPlayback } from './outreach-progress.ts';
import { type PacketProposal, proposalsForMap } from './packet-selection.ts';
import type { ReconciliationMapPresentation } from './reconciliation.ts';
import { type BoundaryShape, type Position, territoryBoundary } from './territory-geometry.ts';
import {
  type ApartmentSelectionSource,
  apartmentFocusZoom,
  apartmentMarkerColor,
  coverageColors,
  mapMarkerStyle,
  segmentMapAppearance,
  segmentVisibleOnMap,
  territoryBoundaryStyle,
} from './territory-map-style.ts';
import type { ApartmentSite, TerritorySegment } from './territory-workspace.ts';

export type MapLifecycleStatus =
  | { state: 'loading' }
  | { state: 'ready' }
  | { state: 'error'; message: string };

export type WorkspaceMapBasePresentation = {
  kind: 'base';
  data: OpenMapData;
  mapType: StreetlightMapType;
};

export type WorkspaceMapPresentation =
  | WorkspaceMapBasePresentation
  | {
      kind: 'coverage';
      visible: boolean;
      interactive: boolean;
      segments: CoverageWorkspaceSegment[];
      apartments: CoverageWorkspaceApartment[];
      selectedSegmentId: string | null;
      selectionSource: CoverageSelectionSource | null;
      showApartmentMarkers: boolean;
      fitOnFirstShow: boolean;
      onSelectSegment: (id: string) => void;
    }
  | {
      kind: 'territory';
      visible: boolean;
      interactive: boolean;
      center: Position;
      radiusMiles: number;
      boundaryShape: BoundaryShape;
      segments: TerritorySegment[];
      apartments: ApartmentSite[];
      mutationLocked: boolean;
      selectedSegmentIds: string[];
      roadFocusRequest: { ids: string[]; key: number } | null;
      showHiddenRoads: boolean;
      boxSelectionArmed: boolean;
      onBoxSelectionComplete: () => void;
      onSelectSegments: (ids: string[], additive: boolean) => void;
      onSelectApartment: (id: string) => void;
      groupingMemberIds: string[] | null;
      onToggleApartmentMember: (id: string) => void;
      selectedApartmentId: string | null;
      selectedApartmentPosition: Position | null;
      apartmentSelectionSource: ApartmentSelectionSource | null;
    }
  | {
      kind: 'proposals';
      visible: boolean;
      proposals: PacketProposal[];
      selectedIndex: number | null;
    }
  | {
      animated: boolean;
      cinematic: boolean;
      fitForPrint: boolean;
      kind: 'progress';
      position: number;
      visible: boolean;
      progress: OutreachProgressPeriod;
      workspace: CoverageWorkspace;
    }
  | {
      kind: 'reconciliation';
      visible: boolean;
      presentation: ReconciliationMapPresentation;
    };

export type MapOverlayEvent = {
  features?: Array<{
    geometry: { type: string; coordinates?: Position };
    properties?: Record<string, unknown> | null;
  }>;
  shiftKey?: boolean;
};

export type MapOverlayLayer = {
  id: string;
  type: 'circle' | 'fill' | 'line' | 'symbol';
  source: string;
  filter?: unknown[];
  layout?: Record<string, unknown>;
  paint?: Record<string, unknown>;
  visible?: boolean;
};

export type ProgressMapMask = {
  visible: boolean;
  lines: Array<Position[]>;
  active?: { lines: Array<Position[]>; opacity: number };
};

export type MapOverlayMarker =
  | {
      key: string;
      kind: 'pin';
      symbol: 'church' | 'start';
      position: Position;
      title?: string;
    }
  | {
      key: string;
      kind: 'label';
      position: Position;
      text: string;
      color: string;
      title: string;
    };

export type MapOverlayAdapter = {
  initialBase: WorkspaceMapBasePresentation;
  waitUntilReady: () => Promise<void>;
  waitUntilSettled: (signal: AbortSignal) => Promise<void>;
  replaceStyle: (base: WorkspaceMapBasePresentation) => Promise<void>;
  hasSource: (id: string) => boolean;
  addSource: (id: string, data: unknown, options?: Record<string, unknown>) => void;
  setSourceData: (id: string, data: unknown) => void;
  updateSourceProperties: (
    id: string,
    updates: Array<{ id: string; properties: Record<string, unknown> }>,
  ) => void;
  removeSource: (id: string) => void;
  hasLayer: (id: string) => boolean;
  addLayer: (layer: MapOverlayLayer, before?: string) => void;
  removeLayer: (id: string) => void;
  setLayerVisibility: (id: string, visible: boolean) => void;
  setPaintProperty: (id: string, property: string, value: unknown) => void;
  setProgressMask: (mask: ProgressMapMask) => void;
  styleLayers: () => ReadonlyArray<{
    id: string;
    type: string;
    source?: string;
    sourceLayer?: string;
  }>;
  onLayer: (
    event: 'click' | 'mouseenter' | 'mouseleave',
    layerId: string,
    listener: (event: MapOverlayEvent) => void,
  ) => () => void;
  setCursor: (cursor: '' | 'crosshair' | 'pointer') => void;
  resize: () => void;
  fitBounds: (bounds: [Position, Position], options: Record<string, unknown>) => void;
  easeTo: (camera: { center?: Position; zoom?: number }) => void;
  getZoom: () => number;
  getClusterExpansionZoom: (sourceId: string, clusterId: number) => Promise<number>;
  registerBoxSelection: (options: {
    armed: boolean;
    layerIds: string[];
    onComplete: (ids: string[], additive: boolean) => void;
    onEmptyClick: () => void;
  }) => () => void;
  addMarker: (marker: MapOverlayMarker) => () => void;
  dispose: () => void;
};

export type MapOverlayLifecycle = {
  attach: (adapter: MapOverlayAdapter) => () => void;
  present: (presentation: WorkspaceMapPresentation) => () => void;
  whenSettled: (signal: AbortSignal) => Promise<void>;
  dispose: () => void;
};

type PresentationKind = WorkspaceMapPresentation['kind'];
type Slot = { token: number; value: WorkspaceMapPresentation };

const COVERAGE_SOURCE = 'streetlightCoverage';
const APARTMENT_SOURCE = 'streetlightApartments';
const COVERAGE_LAYERS = [
  'streetlight-coverage-selection',
  'streetlight-coverage',
  'streetlight-territory-hidden',
] as const;
const APARTMENT_LAYERS = [
  'streetlight-apartment-clusters',
  'streetlight-apartment-cluster-count',
  'streetlight-apartments',
  'streetlight-apartment-labels',
] as const;
const TERRITORY_LAYERS = [
  'territory-boundary-fill',
  'territory-boundary-line',
  'streetlight-apartment-selection-fill',
  'streetlight-apartment-selection-line',
] as const;
const PROGRESS_LAYERS = [
  'streetlight-progress-context',
  'streetlight-progress-lines',
  'streetlight-progress-lines-active',
  'streetlight-progress-apartment-context',
  'streetlight-progress-apartments',
] as const;
const OWNED_LAYERS = [
  'streetlight-boundary',
  ...COVERAGE_LAYERS,
  ...APARTMENT_LAYERS,
  ...TERRITORY_LAYERS,
  'streetlight-packet-proposals-halo',
  ...PROGRESS_LAYERS,
  'streetlight-reconciliation-halo',
  'streetlight-reconciliation-line',
] as const;
const OWNED_SOURCES = [
  'streetlightBoundary',
  COVERAGE_SOURCE,
  APARTMENT_SOURCE,
  'territory-boundary-fill',
  'territory-boundary-line',
  'streetlight-apartment-selection',
  'streetlight-packet-proposals',
  'streetlightProgress',
  'streetlightProgressCompleted',
  'streetlightProgressActive',
  'streetlight-reconciliation',
] as const;

const emptyCollection = () => ({ type: 'FeatureCollection', features: [] });

function sameBaseStyle(
  left: WorkspaceMapBasePresentation | null,
  right: WorkspaceMapBasePresentation | null,
): boolean {
  // Imported buildings and house-number labels are immutable within a territory generation.
  return (
    left !== null &&
    right !== null &&
    left.data.territoryId === right.data.territoryId &&
    left.data.importGeneration === right.data.importGeneration &&
    left.mapType === right.mapType
  );
}

function beforeLabels(adapter: MapOverlayAdapter): string | undefined {
  return adapter.hasLayer('highway-name-minor') ? 'highway-name-minor' : undefined;
}

function coverageWidth(adjust: (width: number) => unknown = (width) => width): unknown[] {
  return ['interpolate', ['linear'], ['zoom'], 11, adjust(2), 14, adjust(5)];
}

function selectionWidth(): unknown[] {
  return ['interpolate', ['linear'], ['zoom'], 11, 10, 14, 13];
}

function setVisible(adapter: MapOverlayAdapter, ids: readonly string[], visible: boolean): void {
  for (const id of ids) if (adapter.hasLayer(id)) adapter.setLayerVisibility(id, visible);
}

function featureCollection(features: unknown[]): unknown {
  return { type: 'FeatureCollection', features };
}

function progressLinePortion(
  geometry: { type: 'LineString'; coordinates: Position[] },
  fraction: number,
): { type: 'LineString'; coordinates: Position[] } | null {
  if (fraction <= 0) return null;
  if (fraction >= 1) return geometry;
  const lengths = geometry.coordinates.slice(1).map((coordinate, index) => {
    const previous = geometry.coordinates[index];
    const latitudeScale = Math.cos((((previous[1] + coordinate[1]) / 2) * Math.PI) / 180);
    const longitude = (coordinate[0] - previous[0]) * latitudeScale;
    const latitude = coordinate[1] - previous[1];
    return Math.hypot(longitude, latitude);
  });
  const target = lengths.reduce((total, length) => total + length, 0) * fraction;
  const coordinates: Position[] = [geometry.coordinates[0]];
  let covered = 0;
  for (const [index, length] of lengths.entries()) {
    const next = geometry.coordinates[index + 1];
    if (covered + length <= target) {
      coordinates.push(next);
      covered += length;
      continue;
    }
    const previous = geometry.coordinates[index];
    const partial = length === 0 ? 0 : (target - covered) / length;
    coordinates.push([
      previous[0] + (next[0] - previous[0]) * partial,
      previous[1] + (next[1] - previous[1]) * partial,
    ]);
    break;
  }
  return coordinates.length > 1 ? { type: 'LineString', coordinates } : null;
}

function ensureSource(
  adapter: MapOverlayAdapter,
  id: string,
  data: unknown,
  options?: Record<string, unknown>,
): void {
  if (adapter.hasSource(id)) adapter.setSourceData(id, data);
  else adapter.addSource(id, data, options);
}

function ensureLayer(adapter: MapOverlayAdapter, layer: MapOverlayLayer, before?: string): void {
  if (!adapter.hasLayer(layer.id)) adapter.addLayer(layer, before);
}

export function createMapOverlayLifecycle({
  onStatus,
}: {
  onStatus: (status: MapLifecycleStatus) => void;
}): MapOverlayLifecycle {
  const slots = new Map<PresentationKind, Slot>();
  const cleanups = new Map<PresentationKind, Array<() => void>>();
  let adapter: MapOverlayAdapter | null = null;
  let adapterToken = 0;
  let presentationToken = 0;
  let disposed = false;
  let ready = false;
  let styleRunning = false;
  let styleEpoch = 0;
  let appliedBase: WorkspaceMapBasePresentation | null = null;
  let statusState: MapLifecycleStatus['state'] | null = null;
  const statusListeners = new Set<() => void>();
  let coverageFitted = false;
  let coverageFocusKey = '';
  let proposalFocusKey = '';
  let reconciliationFocusKey: string | null = null;
  let territoryRoadFocusKey: number | null = null;
  let territoryApartmentFocusKey = '';
  let progressSourcePeriod: OutreachProgressPeriod | null = null;
  let progressSourceWorkspace: CoverageWorkspace | null = null;
  let progressCompletedKey = '';
  let progressActive = false;
  let progressPrintFocusKey = '';
  let progressRows: Array<{
    completedOn: string;
    completedStep: number;
    geometry:
      | { type: 'LineString'; coordinates: Position[] }
      | { type: 'Point'; coordinates: Position };
  }> = [];
  let territoryCenter: Position | null = null;
  let suppressedRoadLayerIds: string[] = [];
  let roadSourceOwner: 'coverage' | 'territory' | null = null;
  let roadSelectedIds = new Set<string>();
  let coverageSegments: CoverageWorkspaceSegment[] | null = null;
  let coverageRoadIndex: CoverageRoad<CoverageWorkspaceSegment>[] = [];
  let coverageApartments: CoverageWorkspaceApartment[] | null = null;
  let territoryRoads: Extract<WorkspaceMapPresentation, { kind: 'territory' }> | null = null;
  let territorySegmentsById = new Map<string, TerritorySegment>();

  const reducedMotion = () =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function status(next: MapLifecycleStatus): void {
    if (next.state !== 'error' && next.state === statusState) return;
    statusState = next.state;
    onStatus(next);
    for (const listener of statusListeners) listener();
  }

  function clearRuntime(kind: PresentationKind): void {
    for (const cleanup of cleanups.get(kind) ?? []) cleanup();
    cleanups.delete(kind);
  }

  function addCleanup(kind: PresentationKind, cleanup: () => void): void {
    cleanups.set(kind, [...(cleanups.get(kind) ?? []), cleanup]);
  }

  function restoreRoadLayers(current: MapOverlayAdapter): void {
    for (const id of suppressedRoadLayerIds) {
      if (current.hasLayer(id)) current.setLayerVisibility(id, true);
    }
    suppressedRoadLayerIds = [];
  }

  function cleanupRuntime(): void {
    for (const kind of [...cleanups.keys()]) clearRuntime(kind);
    if (adapter) {
      adapter.setProgressMask({ visible: false, lines: [] });
      restoreRoadLayers(adapter);
    }
  }

  function removeOwned(current: MapOverlayAdapter): void {
    for (const id of [...OWNED_LAYERS].reverse()) {
      if (current.hasLayer(id)) current.removeLayer(id);
    }
    for (const id of [...OWNED_SOURCES].reverse()) {
      if (current.hasSource(id)) current.removeSource(id);
    }
  }

  function basePresentation(): WorkspaceMapBasePresentation | null {
    const value = slots.get('base')?.value;
    return value?.kind === 'base' ? value : null;
  }

  function coveragePresentation() {
    const value = slots.get('coverage')?.value;
    return value?.kind === 'coverage' ? value : null;
  }

  function territoryPresentation() {
    const value = slots.get('territory')?.value;
    return value?.kind === 'territory' ? value : null;
  }

  function sharedRoadsVisible(): boolean {
    return Boolean(coveragePresentation()?.visible || territoryPresentation()?.visible);
  }

  function sharedApartmentsVisible(): boolean {
    const coverage = coveragePresentation();
    const territory = territoryPresentation();
    return Boolean((coverage?.visible && coverage.showApartmentMarkers) || territory?.visible);
  }

  function reconcileBase(current: MapOverlayAdapter, value: WorkspaceMapBasePresentation): void {
    ensureSource(current, 'streetlightBoundary', {
      type: 'Feature',
      properties: {},
      geometry: value.data.boundary,
    });
    ensureLayer(
      current,
      {
        id: 'streetlight-boundary',
        type: 'line',
        source: 'streetlightBoundary',
        paint: {
          'line-color': territoryBoundaryStyle.color,
          'line-opacity': territoryBoundaryStyle.opacity,
          'line-width': territoryBoundaryStyle.width,
          'line-dasharray': [...territoryBoundaryStyle.dashArray],
        },
      },
      beforeLabels(current),
    );
    current.setLayerVisibility('streetlight-boundary', Boolean(coveragePresentation()?.visible));
    addCleanup(
      'base',
      current.addMarker({
        key: 'church',
        kind: 'pin',
        symbol: 'church',
        position: value.data.center,
      }),
    );
  }

  function ensureCoverageLayers(current: MapOverlayAdapter): void {
    if (!current.hasSource(COVERAGE_SOURCE)) {
      current.addSource(COVERAGE_SOURCE, emptyCollection());
      roadSourceOwner = null;
    }
    if (!current.hasSource(APARTMENT_SOURCE)) {
      current.addSource(APARTMENT_SOURCE, emptyCollection(), {
        cluster: true,
        clusterRadius: 44,
        clusterMaxZoom: 16,
      });
      coverageApartments = null;
    }
    const labels = beforeLabels(current);
    ensureLayer(
      current,
      {
        id: 'streetlight-coverage-selection',
        type: 'line',
        source: COVERAGE_SOURCE,
        filter: ['==', ['get', 'selected'], true],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#78a9ff',
          'line-opacity': 1,
          'line-width': selectionWidth(),
        },
      },
      labels,
    );
    ensureLayer(
      current,
      {
        id: 'streetlight-coverage',
        type: 'line',
        source: COVERAGE_SOURCE,
        filter: ['!=', ['get', 'hidden'], true],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-opacity': ['case', ['==', ['get', 'selected'], true], 1, ['get', 'opacity']],
          'line-width': coverageWidth(),
        },
      },
      labels,
    );
    ensureLayer(
      current,
      {
        id: 'streetlight-territory-hidden',
        type: 'line',
        source: COVERAGE_SOURCE,
        filter: ['==', ['get', 'hidden'], true],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-opacity': ['get', 'opacity'],
          'line-width': coverageWidth(),
        },
      },
      labels,
    );
    ensureLayer(current, {
      id: 'streetlight-apartment-clusters',
      type: 'circle',
      source: APARTMENT_SOURCE,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': mapMarkerStyle.fill,
        'circle-radius': mapMarkerStyle.radius,
        'circle-stroke-color': mapMarkerStyle.outline,
        'circle-stroke-width': mapMarkerStyle.outlineWidth,
      },
    });
    ensureLayer(current, {
      id: 'streetlight-apartment-cluster-count',
      type: 'symbol',
      source: APARTMENT_SOURCE,
      filter: ['has', 'point_count'],
      layout: {
        'text-field': ['get', 'point_count_abbreviated'],
        'text-size': 11,
        'text-font': ['Noto Sans Bold'],
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: { 'text-color': '#ffffff' },
    });
    ensureLayer(current, {
      id: 'streetlight-apartments',
      type: 'circle',
      source: APARTMENT_SOURCE,
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': ['case', ['==', ['get', 'selected'], true], '#2767e9', ['get', 'color']],
        'circle-radius': [
          'case',
          ['==', ['get', 'selected'], true],
          mapMarkerStyle.selectedRadius,
          mapMarkerStyle.radius,
        ],
        'circle-stroke-color': mapMarkerStyle.outline,
        'circle-stroke-width': mapMarkerStyle.outlineWidth,
      },
    });
    ensureLayer(current, {
      id: 'streetlight-apartment-labels',
      type: 'symbol',
      source: APARTMENT_SOURCE,
      filter: ['!', ['has', 'point_count']],
      layout: {
        'text-field': ['get', 'label'],
        'text-size': 11,
        'text-font': ['Noto Sans Bold'],
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: { 'text-color': '#ffffff' },
    });
  }

  function listenForCluster(
    current: MapOverlayAdapter,
    kind: PresentationKind,
    enabled: boolean,
  ): void {
    if (!enabled) return;
    const mapEpoch = adapterToken;
    const presentationEpoch = slots.get(kind)?.token;
    addCleanup(
      kind,
      current.onLayer('click', 'streetlight-apartment-clusters', (event) => {
        const feature = event.features?.[0];
        const clusterId = feature?.properties?.cluster_id;
        const center = feature?.geometry.coordinates;
        if (typeof clusterId !== 'number' || feature?.geometry.type !== 'Point' || !center) return;
        void current
          .getClusterExpansionZoom(APARTMENT_SOURCE, clusterId)
          .then((zoom) => {
            if (
              !disposed &&
              adapter === current &&
              adapterToken === mapEpoch &&
              slots.get(kind)?.token === presentationEpoch
            ) {
              current.easeTo({ center, zoom });
            }
          })
          .catch(() => undefined);
      }),
    );
  }

  function reconcileCoverage(
    current: MapOverlayAdapter,
    value: Extract<WorkspaceMapPresentation, { kind: 'coverage' }>,
  ): void {
    ensureCoverageLayers(current);
    if (value.visible && !territoryPresentation()?.visible) {
      const sourceChanged = roadSourceOwner !== 'coverage' || coverageSegments !== value.segments;
      if (coverageSegments !== value.segments) {
        coverageSegments = value.segments;
        coverageRoadIndex = coverageRoads(value.segments);
      }
      const selectedRoad = coverageRoadForSegment(coverageRoadIndex, value.selectedSegmentId);
      const selectedIds = new Set(
        value.interactive ? selectedRoad?.segments.map(({ id }) => id) : [],
      );
      if (sourceChanged) {
        current.setSourceData(
          COVERAGE_SOURCE,
          featureCollection(
            value.segments.map((segment) => ({
              type: 'Feature',
              id: segment.id,
              geometry: segment.geometry,
              properties: {
                id: segment.id,
                selected: selectedIds.has(segment.id),
                color: segment.eligible
                  ? coverageColors[segment.coverageClass]
                  : coverageColors.gray,
                opacity: segment.eligible ? 0.68 : 0.42,
                hidden: false,
              },
            })),
          ),
        );
        roadSourceOwner = 'coverage';
        roadSelectedIds = selectedIds;
      } else updateRoadSelection(current, selectedIds);
      if (coverageApartments !== value.apartments) {
        current.setSourceData(
          APARTMENT_SOURCE,
          featureCollection(
            value.apartments.map((apartment) => ({
              type: 'Feature',
              geometry: { type: 'Point', coordinates: apartment.position },
              properties: { id: apartment.id, label: 'A', color: apartmentMarkerColor(apartment) },
            })),
          ),
        );
        coverageApartments = value.apartments;
      }
      if (value.fitOnFirstShow && !coverageFitted) {
        const bounds = positionBounds(
          value.segments.flatMap(({ geometry }) => geometry.coordinates),
        );
        if (bounds) {
          current.fitBounds(bounds, { padding: 48 });
          coverageFitted = true;
        }
      }
      if (value.selectedSegmentId && value.selectionSource) {
        const bounds = positionBounds(
          selectedRoad?.segments.flatMap(({ geometry }) => geometry.coordinates) ?? [],
        );
        const focusKey = `${value.selectionSource}:${value.selectedSegmentId}:${JSON.stringify(bounds)}`;
        if (bounds && focusKey !== coverageFocusKey) {
          current.fitBounds(
            bounds,
            coverageSelectionCameraOptions(value.selectionSource, reducedMotion()),
          );
          coverageFocusKey = focusKey;
        }
      } else {
        coverageFocusKey = '';
      }
      listenForCluster(current, 'coverage', value.showApartmentMarkers);
      if (value.interactive) {
        addCleanup(
          'coverage',
          current.onLayer('click', 'streetlight-coverage', (event) => {
            const id = event.features?.[0]?.properties?.id;
            if (typeof id === 'string') value.onSelectSegment(id);
          }),
        );
        const pointer = () => current.setCursor('pointer');
        const clear = () => current.setCursor('');
        addCleanup('coverage', current.onLayer('mouseenter', 'streetlight-coverage', pointer));
        addCleanup('coverage', current.onLayer('mouseleave', 'streetlight-coverage', clear));
        addCleanup('coverage', clear);
      }
    } else {
      coverageFocusKey = '';
    }
    if (current.hasLayer('streetlight-apartments')) {
      current.setPaintProperty(
        'streetlight-apartments',
        'circle-stroke-width',
        mapMarkerStyle.outlineWidth,
      );
    }
    for (const layerId of ['streetlight-coverage', 'streetlight-territory-hidden']) {
      if (current.hasLayer(layerId)) {
        current.setPaintProperty(layerId, 'line-width', coverageWidth());
      }
    }
    setVisible(current, COVERAGE_LAYERS, sharedRoadsVisible());
    setVisible(current, APARTMENT_LAYERS, sharedApartmentsVisible());
  }

  function suppressBaseRoads(current: MapOverlayAdapter): void {
    restoreRoadLayers(current);
    suppressedRoadLayerIds = current
      .styleLayers()
      .filter(
        (layer) =>
          layer.source === 'openmaptiles' &&
          layer.sourceLayer === 'transportation' &&
          (layer.type === 'line' || layer.type === 'fill'),
      )
      .map(({ id }) => id);
    for (const id of suppressedRoadLayerIds) {
      if (current.hasLayer(id)) current.setLayerVisibility(id, false);
    }
  }

  function updateRoadSelection(
    current: MapOverlayAdapter,
    selectedIds: Set<string>,
    territory = false,
  ): void {
    const updates = [...new Set([...roadSelectedIds, ...selectedIds])]
      .filter((id) => roadSelectedIds.has(id) !== selectedIds.has(id))
      .map((id) => {
        const selected = selectedIds.has(id);
        const segment = territory ? territorySegmentsById.get(id) : undefined;
        return {
          id,
          properties: {
            selected,
            ...(segment ? { opacity: segmentMapAppearance(segment, selected).strokeOpacity } : {}),
          },
        };
      });
    if (updates.length > 0) current.updateSourceProperties(COVERAGE_SOURCE, updates);
    roadSelectedIds = selectedIds;
  }

  function reconcileTerritory(
    current: MapOverlayAdapter,
    value: Extract<WorkspaceMapPresentation, { kind: 'territory' }>,
  ): void {
    ensureCoverageLayers(current);
    if (!value.visible) {
      setVisible(current, TERRITORY_LAYERS, false);
      restoreRoadLayers(current);
      setVisible(current, COVERAGE_LAYERS, sharedRoadsVisible());
      setVisible(current, APARTMENT_LAYERS, sharedApartmentsVisible());
      territoryCenter = value.center;
      territoryRoadFocusKey = null;
      return;
    }
    for (const id of [
      'territory-boundary-fill',
      'territory-boundary-line',
      'streetlight-apartment-selection',
    ] as const) {
      if (!current.hasSource(id)) current.addSource(id, emptyCollection());
    }
    const labels = beforeLabels(current);
    ensureLayer(
      current,
      {
        id: 'territory-boundary-fill',
        type: 'fill',
        source: 'territory-boundary-fill',
        paint: {
          'fill-color': territoryBoundaryStyle.fill,
          'fill-opacity': territoryBoundaryStyle.fillOpacity,
        },
      },
      labels,
    );
    ensureLayer(
      current,
      {
        id: 'territory-boundary-line',
        type: 'line',
        source: 'territory-boundary-line',
        paint: {
          'line-color': territoryBoundaryStyle.color,
          'line-opacity': territoryBoundaryStyle.opacity,
          'line-width': territoryBoundaryStyle.width,
          'line-dasharray': [...territoryBoundaryStyle.dashArray],
        },
      },
      labels,
    );
    ensureLayer(
      current,
      {
        id: 'streetlight-apartment-selection-fill',
        type: 'fill',
        source: 'streetlight-apartment-selection',
        paint: { 'fill-color': '#d2a128', 'fill-opacity': 0.16 },
      },
      labels,
    );
    ensureLayer(
      current,
      {
        id: 'streetlight-apartment-selection-line',
        type: 'line',
        source: 'streetlight-apartment-selection',
        paint: { 'line-color': '#b07a17', 'line-width': 3, 'line-opacity': 0.9 },
      },
      labels,
    );
    setVisible(current, TERRITORY_LAYERS, true);
    suppressBaseRoads(current);
    const boundary = territoryBoundary(value.center, value.radiusMiles, value.boundaryShape);
    current.setSourceData('territory-boundary-fill', {
      type: 'Feature',
      properties: {},
      geometry: boundary,
    });
    current.setSourceData('territory-boundary-line', {
      type: 'Feature',
      properties: {},
      geometry: boundary,
    });
    const selectedApartment = value.apartments.find(({ id }) => id === value.selectedApartmentId);
    const apartmentGeometries = selectedApartment
      ? [
          selectedApartment.boundary,
          ...selectedApartment.members.map(({ geometry }) => geometry),
        ].filter((geometry): geometry is NonNullable<typeof geometry> => geometry !== null)
      : [];
    current.setSourceData(
      'streetlight-apartment-selection',
      featureCollection(
        apartmentGeometries.map((geometry) => ({ type: 'Feature', properties: {}, geometry })),
      ),
    );
    const selectedIds = new Set(value.selectedSegmentIds);
    const sourceChanged =
      roadSourceOwner !== 'territory' ||
      territoryRoads?.segments !== value.segments ||
      territoryRoads?.showHiddenRoads !== value.showHiddenRoads ||
      territoryRoads?.interactive !== value.interactive ||
      territoryRoads?.mutationLocked !== value.mutationLocked;
    if (sourceChanged) {
      const visibleSegments = value.segments.filter((segment) =>
        segmentVisibleOnMap(segment, value.showHiddenRoads),
      );
      territorySegmentsById = new Map(visibleSegments.map((segment) => [segment.id, segment]));
      current.setSourceData(
        COVERAGE_SOURCE,
        featureCollection(
          visibleSegments.map((segment) => {
            const appearance = segmentMapAppearance(segment, selectedIds.has(segment.id));
            return {
              type: 'Feature',
              id: segment.id,
              geometry: segment.geometry,
              properties: {
                id: segment.id,
                active: segment.active,
                manuallyExcluded: segment.manuallyExcluded,
                hidden: !segment.active && !segment.manuallyExcluded,
                selected: appearance.selected,
                selectable: value.interactive && !value.mutationLocked && appearance.selectable,
                color: appearance.strokeColor,
                opacity: appearance.strokeOpacity,
                weightOffset: appearance.weightOffset,
              },
            };
          }),
        ),
      );
      roadSourceOwner = 'territory';
      roadSelectedIds = selectedIds;
    } else updateRoadSelection(current, selectedIds, true);
    territoryRoads = value;
    for (const layerId of ['streetlight-coverage', 'streetlight-territory-hidden']) {
      if (current.hasLayer(layerId)) {
        current.setPaintProperty(
          layerId,
          'line-width',
          coverageWidth((width) => ['max', 1, ['+', width, ['get', 'weightOffset']]]),
        );
      }
    }
    const apartmentRows = value.groupingMemberIds
      ? value.apartments.flatMap((site) =>
          site.members.map((member) => ({
            id: member.id,
            position: member.position,
            includedInPackets: site.includedInPackets,
          })),
        )
      : value.apartments
          .filter(({ withinBoundary }) => withinBoundary)
          .map((site) => ({
            id: site.id,
            position: site.position,
            includedInPackets: site.includedInPackets,
          }));
    current.setSourceData(
      APARTMENT_SOURCE,
      featureCollection(
        apartmentRows.map((apartment) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: apartment.position },
          properties: {
            id: apartment.id,
            label: 'A',
            color: apartmentMarkerColor(apartment),
            selected: value.groupingMemberIds
              ? value.groupingMemberIds.includes(apartment.id)
              : apartment.id === value.selectedApartmentId,
          },
        })),
      ),
    );
    coverageApartments = null;
    setVisible(current, COVERAGE_LAYERS, true);
    setVisible(current, APARTMENT_LAYERS, true);
    current.setPaintProperty('streetlight-apartments', 'circle-stroke-width', [
      'case',
      ['get', 'selected'],
      3,
      mapMarkerStyle.outlineWidth,
    ]);

    if (
      territoryCenter &&
      (territoryCenter[0] !== value.center[0] || territoryCenter[1] !== value.center[1])
    ) {
      current.easeTo({ center: value.center });
    }
    territoryCenter = value.center;
    if (value.roadFocusRequest && territoryRoadFocusKey !== value.roadFocusRequest.key) {
      const bounds = segmentSelectionBounds(value.segments, value.roadFocusRequest.ids);
      if (bounds) {
        current.fitBounds(bounds, coverageSelectionCameraOptions('search', reducedMotion()));
        territoryRoadFocusKey = value.roadFocusRequest.key;
      }
    } else if (!value.roadFocusRequest) {
      territoryRoadFocusKey = null;
    }
    if (
      value.interactive &&
      value.selectedApartmentId &&
      value.selectedApartmentPosition &&
      value.apartmentSelectionSource
    ) {
      const focusKey = `${value.apartmentSelectionSource}:${value.selectedApartmentId}:${value.selectedApartmentPosition.join(',')}`;
      const zoom = apartmentFocusZoom(value.apartmentSelectionSource, current.getZoom());
      if (zoom !== null && focusKey !== territoryApartmentFocusKey) {
        current.easeTo({ center: value.selectedApartmentPosition, zoom });
        territoryApartmentFocusKey = focusKey;
      }
    } else {
      territoryApartmentFocusKey = '';
    }
    if (!value.interactive || value.mutationLocked) return;
    const selectRoad = (event: MapOverlayEvent) => {
      if (event.shiftKey) return;
      const properties = event.features?.find(
        ({ properties }) => properties?.selectable,
      )?.properties;
      if (typeof properties?.id === 'string') {
        value.onSelectSegments([properties.id], Boolean(event.shiftKey));
      }
    };
    for (const layerId of ['streetlight-coverage', 'streetlight-territory-hidden']) {
      addCleanup('territory', current.onLayer('click', layerId, selectRoad));
      addCleanup(
        'territory',
        current.onLayer('mouseenter', layerId, (event) => {
          if (event.features?.some(({ properties }) => properties?.selectable)) {
            current.setCursor('pointer');
          }
        }),
      );
      addCleanup(
        'territory',
        current.onLayer('mouseleave', layerId, () => current.setCursor('')),
      );
    }
    addCleanup(
      'territory',
      current.onLayer('click', 'streetlight-apartments', (event) => {
        const id = event.features?.[0]?.properties?.id;
        if (typeof id !== 'string') return;
        if (value.groupingMemberIds) value.onToggleApartmentMember(id);
        else value.onSelectApartment(id);
      }),
    );
    listenForCluster(current, 'territory', true);
    for (const layerId of ['streetlight-apartment-clusters', 'streetlight-apartments']) {
      addCleanup(
        'territory',
        current.onLayer('mouseenter', layerId, () => current.setCursor('pointer')),
      );
      addCleanup(
        'territory',
        current.onLayer('mouseleave', layerId, () => current.setCursor('')),
      );
    }
    addCleanup(
      'territory',
      current.registerBoxSelection({
        armed: value.boxSelectionArmed,
        layerIds: ['streetlight-coverage', 'streetlight-territory-hidden'],
        onComplete: (ids, additive) => {
          if (ids.length > 0) value.onSelectSegments(ids, additive);
          value.onBoxSelectionComplete();
        },
        onEmptyClick: () => {
          if (value.selectedSegmentIds.length > 0) value.onSelectSegments([], false);
        },
      }),
    );
    addCleanup('territory', () => current.setCursor(''));
  }

  function reconcileProposals(
    current: MapOverlayAdapter,
    value: Extract<WorkspaceMapPresentation, { kind: 'proposals' }>,
  ): void {
    const visible = proposalsForMap(value.proposals, value.selectedIndex);
    if (!value.visible || visible.length === 0) {
      proposalFocusKey = '';
      if (current.hasSource('streetlight-packet-proposals')) {
        current.setSourceData('streetlight-packet-proposals', emptyCollection());
      }
      setVisible(current, ['streetlight-packet-proposals-halo'], false);
      return;
    }
    ensureSource(current, 'streetlight-packet-proposals', emptyCollection());
    const before = current.hasLayer('streetlight-coverage')
      ? 'streetlight-coverage'
      : beforeLabels(current);
    ensureLayer(
      current,
      {
        id: 'streetlight-packet-proposals-halo',
        type: 'line',
        source: 'streetlight-packet-proposals',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#78a9ff',
          'line-opacity': 1,
          'line-width': selectionWidth(),
        },
      },
      before,
    );
    current.setSourceData(
      'streetlight-packet-proposals',
      featureCollection(
        visible.flatMap((proposal) =>
          proposal.segments.map((segment) => ({
            type: 'Feature',
            geometry: segment.geometry,
            properties: {},
          })),
        ),
      ),
    );
    current.setLayerVisibility(
      'streetlight-packet-proposals-halo',
      value.visible && visible.length > 0,
    );
    const selected = value.selectedIndex === null ? null : visible[0];
    const markers = visible.filter(
      (proposal) => proposal.kind === 'apartment' || proposal === selected,
    );
    for (const proposal of markers) {
      addCleanup(
        'proposals',
        current.addMarker({
          key: `proposal:${proposal.start.address}:${proposal.start.position.join(',')}`,
          kind: 'pin',
          symbol: 'start',
          position: proposal.start.position,
          title: proposal.kind === 'apartment' ? 'Apartment complex' : 'Starting address',
        }),
      );
    }
    const positions = visible.flatMap((proposal) =>
      proposal.segments.flatMap(({ geometry }) => geometry.coordinates),
    );
    positions.push(...markers.map(({ start }) => start.position));
    const bounds = positionBounds(positions);
    const focusKey = `${value.selectedIndex ?? 'all'}:${JSON.stringify(bounds)}`;
    if (focusKey !== proposalFocusKey) {
      if (bounds) current.fitBounds(bounds, { padding: 56 });
      proposalFocusKey = focusKey;
    }
  }

  function reconcileProgress(
    current: MapOverlayAdapter,
    value: Extract<WorkspaceMapPresentation, { kind: 'progress' }>,
  ): void {
    if (!value.visible) {
      current.setProgressMask({ visible: false, lines: [] });
      setVisible(current, PROGRESS_LAYERS, false);
      return;
    }
    const sourceChanged =
      !current.hasSource('streetlightProgress') ||
      progressSourcePeriod !== value.progress ||
      progressSourceWorkspace !== value.workspace;
    if (sourceChanged) {
      ensureSource(
        current,
        'streetlightProgress',
        featureCollection([
          ...value.workspace.segments.map((segment) => ({
            type: 'Feature',
            geometry: segment.geometry,
            properties: {},
          })),
          ...value.workspace.apartmentComplexes.map((apartment) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: apartment.position },
            properties: {},
          })),
        ]),
      );
      progressRows = value.progress.units.map((unit) => ({
        completedOn: unit.completedOn,
        completedStep: value.progress.dates.indexOf(unit.completedOn) + 1,
        geometry: unit.geometry,
      }));
      progressSourcePeriod = value.progress;
      progressSourceWorkspace = value.workspace;
      progressCompletedKey = '';
      progressActive = false;
    }
    const playback = outreachProgressPlayback(value.progress, value.position);
    const completedKey = `${value.progress.startDate}:${playback.through ?? 'none'}`;
    const completedRows = progressRows.filter(
      ({ completedStep }) => completedStep <= playback.completedStep,
    );
    if (
      !current.hasSource('streetlightProgressCompleted') ||
      progressCompletedKey !== completedKey
    ) {
      ensureSource(
        current,
        'streetlightProgressCompleted',
        featureCollection(
          completedRows.map(({ geometry }) => ({ type: 'Feature', geometry, properties: {} })),
        ),
      );
      progressCompletedKey = completedKey;
    }
    const revealing =
      value.animated &&
      playback.revealDate !== null &&
      playback.revealProgress > 0 &&
      playback.revealProgress < 1;
    const activeRoads = revealing
      ? progressRows.flatMap(({ completedOn, geometry }) => {
          if (geometry.type !== 'LineString' || completedOn !== playback.revealDate) return [];
          const portion = progressLinePortion(geometry, playback.revealProgress);
          return portion ? [portion] : [];
        })
      : [];
    if (revealing) {
      ensureSource(
        current,
        'streetlightProgressActive',
        featureCollection(
          activeRoads.map((geometry) => ({ type: 'Feature', geometry, properties: {} })),
        ),
      );
      progressActive = true;
    } else if (!current.hasSource('streetlightProgressActive') || progressActive) {
      ensureSource(current, 'streetlightProgressActive', emptyCollection());
      progressActive = false;
    }
    current.setProgressMask({
      visible: value.cinematic,
      lines: completedRows.flatMap(({ geometry }) =>
        geometry.type === 'LineString' ? [geometry.coordinates] : [],
      ),
      active:
        activeRoads.length > 0
          ? {
              lines: activeRoads.map(({ coordinates }) => coordinates),
              opacity: (() => {
                const fade = Math.min(playback.revealProgress / 0.25, 1);
                return fade * fade * (3 - 2 * fade);
              })(),
            }
          : undefined,
    });
    const before = beforeLabels(current);
    const layers: MapOverlayLayer[] = [
      {
        id: 'streetlight-progress-context',
        type: 'line',
        source: 'streetlightProgress',
        filter: ['==', ['geometry-type'], 'LineString'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#8f9b94',
          'line-opacity': 0.32,
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.5, 14, 3.5],
        },
      },
      {
        id: 'streetlight-progress-lines',
        type: 'line',
        source: 'streetlightProgressCompleted',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#d79b2b',
          'line-opacity': 0.98,
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 5],
        },
      },
      {
        id: 'streetlight-progress-lines-active',
        type: 'line',
        source: 'streetlightProgressActive',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#d79b2b',
          'line-opacity': 0.98,
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 5],
        },
      },
      {
        id: 'streetlight-progress-apartment-context',
        type: 'circle',
        source: 'streetlightProgress',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-color': '#8f9b94',
          'circle-opacity': 0.48,
          'circle-radius': 4,
          'circle-stroke-color': '#fffdf7',
          'circle-stroke-width': 1,
        },
      },
      {
        id: 'streetlight-progress-apartments',
        type: 'circle',
        source: 'streetlightProgressCompleted',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-color': '#d79b2b',
          'circle-radius': 7,
          'circle-stroke-color': '#fff0b8',
          'circle-stroke-width': 3,
        },
      },
    ];
    for (const layer of layers) ensureLayer(current, layer, before);
    setVisible(current, PROGRESS_LAYERS, value.visible);
    if (value.fitForPrint) {
      const center = value.workspace.center;
      const positions = completedRows.flatMap(({ geometry }) =>
        geometry.type === 'LineString' ? geometry.coordinates : [geometry.coordinates],
      );
      const longitudeRadius = Math.max(
        0.001,
        ...positions.map(([longitude]) => Math.abs(longitude - center[0])),
      );
      const latitudeRadius = Math.max(
        0.001,
        ...positions.map(([, latitude]) => Math.abs(latitude - center[1])),
      );
      const focusKey = `${value.progress.startDate}:${value.progress.endDate}:${positions.length}:${center.join(',')}`;
      if (focusKey !== progressPrintFocusKey) {
        current.resize();
        current.fitBounds(
          [
            [center[0] - longitudeRadius, center[1] - latitudeRadius],
            [center[0] + longitudeRadius, center[1] + latitudeRadius],
          ],
          { duration: 0, maxZoom: 16, padding: 24 },
        );
        progressPrintFocusKey = focusKey;
      }
    } else {
      if (progressPrintFocusKey) current.resize();
      progressPrintFocusKey = '';
    }
  }

  function reconcileReconciliation(
    current: MapOverlayAdapter,
    value: Extract<WorkspaceMapPresentation, { kind: 'reconciliation' }>,
  ): void {
    if (!value.visible || value.presentation.packets.length === 0) {
      setVisible(
        current,
        ['streetlight-reconciliation-halo', 'streetlight-reconciliation-line'],
        false,
      );
      return;
    }
    ensureSource(current, 'streetlight-reconciliation', emptyCollection());
    const haloBefore = current.hasLayer('streetlight-coverage')
      ? 'streetlight-coverage'
      : beforeLabels(current);
    ensureLayer(
      current,
      {
        id: 'streetlight-reconciliation-halo',
        type: 'line',
        source: 'streetlight-reconciliation',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#78a9ff',
          'line-opacity': 1,
          'line-width': selectionWidth(),
        },
      },
      haloBefore,
    );
    ensureLayer(
      current,
      {
        id: 'streetlight-reconciliation-line',
        type: 'line',
        source: 'streetlight-reconciliation',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-opacity': 0.9,
          'line-width': coverageWidth((width) => ['+', width, ['case', ['get', 'selected'], 2, 0]]),
        },
      },
      beforeLabels(current),
    );
    const packets = value.presentation.packets;
    const colors = { complete: '#3e8b65', active: '#1769ff', cancel: '#77736c' };
    current.setSourceData(
      'streetlight-reconciliation',
      featureCollection(
        packets.flatMap(({ packet, disposition, selected }) =>
          packet.segments.map((segment) => ({
            type: 'Feature',
            geometry: segment.geometry,
            properties: {
              color: colors[disposition],
              selected,
            },
          })),
        ),
      ),
    );
    const visible = value.visible && packets.length > 0;
    setVisible(
      current,
      ['streetlight-reconciliation-halo', 'streetlight-reconciliation-line'],
      visible,
    );
    if (!visible) return;
    const selected = packets.find((packet) => packet.selected) ?? null;
    for (const presentation of packets.filter(({ packet }) => packet.apartment)) {
      const { packet, disposition } = presentation;
      if (presentation.selected || !packet.apartment) continue;
      addCleanup(
        'reconciliation',
        current.addMarker({
          key: `reconciliation:${packet.id}`,
          kind: 'label',
          position: packet.apartment.position,
          text: 'A',
          color: colors[disposition],
          title: `${packet.code} · ${packet.estimatedTracts} estimated tract${packet.estimatedTracts === 1 ? '' : 's'}`,
        }),
      );
    }
    if (selected) {
      addCleanup(
        'reconciliation',
        current.addMarker({
          key: `reconciliation-start:${selected.packet.id}`,
          kind: 'pin',
          symbol: 'start',
          position: selected.packet.start.position,
          title: `Starting address: ${selected.packet.start.address}`,
        }),
      );
    }
    const focusKey = value.presentation.focusKey;
    if (focusKey !== reconciliationFocusKey) {
      const focusPackets = selected ? [selected.packet] : packets.map(({ packet }) => packet);
      const positions = focusPackets.flatMap((packet) => [
        ...packet.segments.flatMap(({ geometry }) => geometry.coordinates),
        ...(packet.apartment ? [packet.apartment.position] : []),
      ]);
      const bounds = positionBounds(positions);
      if (bounds) current.fitBounds(bounds, { padding: 56 });
      reconciliationFocusKey = focusKey;
    }
  }

  function reconcile(kind: PresentationKind): void {
    const current = adapter;
    const slot = slots.get(kind);
    if (!current || !ready || styleRunning || !slot) return;
    clearRuntime(kind);
    const value = slot.value;
    switch (value.kind) {
      case 'base':
        reconcileBase(current, value);
        break;
      case 'coverage':
        reconcileCoverage(current, value);
        break;
      case 'territory':
        reconcileTerritory(current, value);
        break;
      case 'proposals':
        reconcileProposals(current, value);
        break;
      case 'progress':
        reconcileProgress(current, value);
        break;
      case 'reconciliation':
        reconcileReconciliation(current, value);
        break;
    }
  }

  function reconcileAll(): void {
    for (const kind of [
      'base',
      'coverage',
      'progress',
      'territory',
      'proposals',
      'reconciliation',
    ] as const) {
      reconcile(kind);
    }
  }

  function reconcileSharedRoads(): void {
    reconcile('coverage');
    reconcile('territory');
    const current = adapter;
    if (!current) return;
    setVisible(current, COVERAGE_LAYERS, sharedRoadsVisible());
    setVisible(current, APARTMENT_LAYERS, sharedApartmentsVisible());
    if (!territoryPresentation()?.visible) {
      setVisible(current, TERRITORY_LAYERS, false);
      restoreRoadLayers(current);
    }
    if (current.hasLayer('streetlight-boundary')) {
      current.setLayerVisibility('streetlight-boundary', Boolean(coveragePresentation()?.visible));
    }
  }

  function reconcileSafely(reconciliation: () => void): void {
    try {
      reconciliation();
      status({ state: 'ready' });
    } catch {
      status({ state: 'error', message: 'Open map could not load.' });
    }
  }

  function replaceLatestStyle(): void {
    const current = adapter;
    const desired = basePresentation();
    if (!current || !ready || styleRunning || !desired || sameBaseStyle(appliedBase, desired))
      return;
    styleRunning = true;
    status({ state: 'loading' });
    cleanupRuntime();
    const mapEpoch = adapterToken;
    const targetStyleEpoch = ++styleEpoch;
    const target = desired;
    void current
      .replaceStyle(target)
      .then(() => {
        if (
          disposed ||
          adapter !== current ||
          adapterToken !== mapEpoch ||
          styleEpoch !== targetStyleEpoch
        )
          return;
        appliedBase = target;
        styleRunning = false;
        const latest = basePresentation();
        if (latest && !sameBaseStyle(latest, appliedBase)) {
          replaceLatestStyle();
          return;
        }
        reconcileAll();
        status({ state: 'ready' });
      })
      .catch(() => {
        if (
          disposed ||
          adapter !== current ||
          adapterToken !== mapEpoch ||
          styleEpoch !== targetStyleEpoch
        )
          return;
        styleRunning = false;
        const latest = basePresentation();
        if (latest && !sameBaseStyle(latest, target)) {
          replaceLatestStyle();
          return;
        }
        status({ state: 'error', message: 'Open map could not load.' });
      });
  }

  function detach(current: MapOverlayAdapter, token: number): void {
    if (adapter !== current || adapterToken !== token) return;
    cleanupRuntime();
    try {
      removeOwned(current);
    } finally {
      current.dispose();
      adapter = null;
      ready = false;
      appliedBase = null;
      styleRunning = false;
      styleEpoch += 1;
      adapterToken += 1;
      for (const listener of statusListeners) listener();
    }
  }

  return {
    async whenSettled(signal) {
      while (true) {
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => {
            statusListeners.delete(check);
            signal.removeEventListener('abort', check);
          };
          const check = () => {
            if (signal.aborted || disposed || !adapter || statusState === 'error') {
              cleanup();
              reject(signal.reason ?? new Error('Open map could not load.'));
            } else if (ready && !styleRunning && statusState === 'ready') {
              cleanup();
              resolve();
            }
          };
          statusListeners.add(check);
          signal.addEventListener('abort', check, { once: true });
          check();
        });
        const current = adapter;
        const revision = presentationToken;
        if (!current) throw new Error('Open map was detached');
        await current.waitUntilSettled(signal);
        if (current === adapter && revision === presentationToken && !styleRunning) return;
      }
    },
    attach(current) {
      if (disposed) throw new Error('Map overlay lifecycle is disposed');
      if (adapter) detach(adapter, adapterToken);
      adapter = current;
      const token = ++adapterToken;
      appliedBase = current.initialBase;
      ready = false;
      status({ state: 'loading' });
      void current
        .waitUntilReady()
        .then(() => {
          if (disposed || adapter !== current || adapterToken !== token) return;
          ready = true;
          const desired = basePresentation();
          if (desired && !sameBaseStyle(desired, appliedBase)) replaceLatestStyle();
          else {
            reconcileAll();
            status({ state: 'ready' });
          }
        })
        .catch(() => {
          if (!disposed && adapter === current && adapterToken === token) {
            status({ state: 'error', message: 'Open map could not load.' });
          }
        });
      return () => detach(current, token);
    },

    present(value) {
      if (disposed) throw new Error('Map overlay lifecycle is disposed');
      const token = ++presentationToken;
      slots.set(value.kind, { token, value });
      if (value.kind === 'base') {
        if (adapter && ready && !styleRunning && sameBaseStyle(appliedBase, value)) {
          reconcileSafely(() => reconcile('base'));
        } else {
          replaceLatestStyle();
        }
      } else if (
        adapter &&
        ready &&
        !styleRunning &&
        (value.kind === 'coverage' || value.kind === 'territory')
      ) {
        reconcileSafely(reconcileSharedRoads);
      } else if (adapter && ready && !styleRunning) reconcileSafely(() => reconcile(value.kind));
      return () => {
        const current = slots.get(value.kind);
        if (!current || current.token !== token) return;
        slots.delete(value.kind);
        clearRuntime(value.kind);
        if (adapter && ready && !styleRunning) {
          if (value.kind === 'coverage' || value.kind === 'territory') {
            reconcileSafely(reconcileSharedRoads);
          } else if (value.kind === 'proposals') {
            setVisible(adapter, ['streetlight-packet-proposals-halo'], false);
          } else if (value.kind === 'progress') {
            adapter.setProgressMask({ visible: false, lines: [] });
            setVisible(adapter, PROGRESS_LAYERS, false);
          } else if (value.kind === 'reconciliation') {
            setVisible(
              adapter,
              ['streetlight-reconciliation-halo', 'streetlight-reconciliation-line'],
              false,
            );
          }
        }
      };
    },

    dispose() {
      if (disposed) return;
      if (adapter) detach(adapter, adapterToken);
      slots.clear();
      disposed = true;
    },
  };
}
