'use client';

import type { GeoJSONSource, MapLayerMouseEvent, Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import type { ApartmentComplex, TerritorySegment } from '@/lib/database';
import { type BoundaryShape, type Position, territoryBoundary } from '@/lib/territory-geometry';
import {
  type ApartmentSelectionSource,
  apartmentFocusZoom,
  apartmentLayerIds,
  apartmentMarkerColor,
  basemapRoadGeometryLayerIds,
  boundaryStrokePaths,
  expandApartmentCluster,
  keepMapOverlayPublished,
  listenForMapStyleLoad,
  segmentMapAppearance,
  segmentVisibleOnMap,
  territoryBoundaryStyle,
} from '@/lib/territory-map-style';

type OpenTerritoryMapProps = {
  active: boolean;
  map: MapLibreMap | null;
  center: Position;
  radiusMiles: number;
  boundaryShape: BoundaryShape;
  segments: TerritorySegment[];
  apartmentComplexes: ApartmentComplex[];
  mutationLocked: boolean;
  selectedSegmentIds: string[];
  showHiddenRoads: boolean;
  boxSelectionArmed: boolean;
  onBoxSelectionComplete: () => void;
  onSelectSegments: (ids: string[], additive: boolean) => void;
  onSelectApartment: (id: string) => void;
  selectedApartmentId: string | null;
  selectedApartmentPosition: Position | null;
  apartmentSelectionSource: ApartmentSelectionSource | null;
};

function beforeRoadLabels(map: MapLibreMap): string | undefined {
  return map.getLayer('highway-name-minor') ? 'highway-name-minor' : undefined;
}

export function OpenTerritoryMap({
  active,
  map,
  center,
  radiusMiles,
  boundaryShape,
  segments,
  apartmentComplexes,
  mutationLocked,
  selectedSegmentIds,
  showHiddenRoads,
  boxSelectionArmed,
  onBoxSelectionComplete,
  onSelectSegments,
  onSelectApartment,
  selectedApartmentId,
  selectedApartmentPosition,
  apartmentSelectionSource,
}: OpenTerritoryMapProps) {
  const mutationLockedRef = useRef(mutationLocked);
  const previousCenterRef = useRef(center);
  const [mapStyleRevision, setMapStyleRevision] = useState(0);
  mutationLockedRef.current = mutationLocked;

  useEffect(() => {
    if (!map) return;
    return listenForMapStyleLoad(map, () => {
      setMapStyleRevision((revision) => revision + 1);
    });
  }, [map]);

  useEffect(() => {
    if (!map) return;
    const setRoadGeometryVisibility = (visibility: 'none' | 'visible') => {
      for (const id of basemapRoadGeometryLayerIds(map.getStyle().layers ?? [])) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility);
      }
    };
    const stop = keepMapOverlayPublished(map, () => {
      setRoadGeometryVisibility(active ? 'none' : 'visible');
    });
    return () => {
      stop();
      if (active) setRoadGeometryVisibility('visible');
    };
  }, [active, map]);

  useEffect(() => {
    const previous = previousCenterRef.current;
    previousCenterRef.current = center;
    if (active && map && (previous[0] !== center[0] || previous[1] !== center[1])) {
      map.easeTo({ center });
    }
  }, [active, center, map]);

  useEffect(() => {
    if (
      !active ||
      !map ||
      !selectedApartmentId ||
      !selectedApartmentPosition ||
      !apartmentSelectionSource
    )
      return;
    const zoom = apartmentFocusZoom(apartmentSelectionSource, map.getZoom());
    if (zoom !== null) map.easeTo({ center: selectedApartmentPosition, zoom });
  }, [active, apartmentSelectionSource, map, selectedApartmentId, selectedApartmentPosition]);

  useEffect(() => {
    if (!active || !map) return;
    const fillSource = 'territory-boundary-fill';
    const lineSource = 'territory-boundary-line';
    const fillLayer = 'territory-boundary-fill';
    const lineLayer = 'territory-boundary-line';
    map.addSource(fillSource, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    map.addSource(lineSource, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    const before = beforeRoadLabels(map);
    map.addLayer(
      {
        id: fillLayer,
        type: 'fill',
        source: fillSource,
        paint: {
          'fill-color': territoryBoundaryStyle.fill,
          'fill-opacity': territoryBoundaryStyle.fillOpacity,
        },
      },
      before,
    );
    map.addLayer(
      {
        id: lineLayer,
        type: 'line',
        source: lineSource,
        paint: {
          'line-color': territoryBoundaryStyle.color,
          'line-opacity': territoryBoundaryStyle.opacity,
          'line-width': territoryBoundaryStyle.width,
          'line-dasharray': [...territoryBoundaryStyle.dashArray],
        },
      },
      before,
    );
    return () => {
      if (map.getLayer(lineLayer)) map.removeLayer(lineLayer);
      if (map.getLayer(fillLayer)) map.removeLayer(fillLayer);
      if (map.getSource(lineSource)) map.removeSource(lineSource);
      if (map.getSource(fillSource)) map.removeSource(fillSource);
    };
  }, [active, map, mapStyleRevision]);

  useEffect(() => {
    if (!active || !map) return;
    const boundary = territoryBoundary(center, radiusMiles, boundaryShape);
    (map.getSource('territory-boundary-fill') as GeoJSONSource | undefined)?.setData({
      type: 'Feature',
      properties: {},
      geometry: boundary,
    });
    (map.getSource('territory-boundary-line') as GeoJSONSource | undefined)?.setData({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'MultiLineString',
        coordinates: boundaryStrokePaths(boundary.coordinates[0], boundaryShape),
      },
    });
  }, [active, boundaryShape, center, map, mapStyleRevision, radiusMiles]);

  useEffect(() => {
    if (!active || !map) return;
    const layerIds = ['streetlight-coverage', 'streetlight-territory-hidden'] as const;
    const selectedIds = new Set(selectedSegmentIds);
    const visibleSegments = segments.filter((segment) =>
      segmentVisibleOnMap(segment, showHiddenRoads),
    );
    (map.getSource('streetlightCoverage') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: visibleSegments.map((segment) => {
        const appearance = segmentMapAppearance(segment, selectedIds.has(segment.id));
        return {
          type: 'Feature' as const,
          geometry: segment.geometry,
          properties: {
            id: segment.id,
            active: segment.active,
            manuallyExcluded: segment.manuallyExcluded,
            hidden: !segment.active && !segment.manuallyExcluded,
            selected: appearance.selected,
            selectable: !mutationLocked && appearance.selectable,
            color: appearance.strokeColor,
            opacity: appearance.strokeOpacity,
            weightOffset: appearance.weightOffset,
          },
        };
      }),
    });
    if (map.getLayer('streetlight-coverage-selection')) {
      map.setLayoutProperty('streetlight-coverage-selection', 'visibility', 'visible');
    }
    for (const layerId of layerIds) {
      if (!map.getLayer(layerId)) continue;
      map.setLayoutProperty(layerId, 'visibility', 'visible');
      map.setPaintProperty(layerId, 'line-width', [
        'max',
        1,
        ['+', ['interpolate', ['linear'], ['zoom'], 11, 2, 14, 5], ['get', 'weightOffset']],
      ]);
    }
    const select = (event: MapLayerMouseEvent) => {
      if (mutationLocked) return;
      const properties = event.features?.find(
        ({ properties }) => properties?.selectable,
      )?.properties;
      if (typeof properties?.id !== 'string') return;
      onSelectSegments([properties.id], event.originalEvent.shiftKey);
    };
    const point = (event: MapLayerMouseEvent) => {
      if (event.features?.some(({ properties }) => properties?.selectable)) {
        map.getCanvas().style.cursor = 'pointer';
      }
    };
    const clear = () => {
      map.getCanvas().style.cursor = '';
    };
    for (const layerId of layerIds) {
      if (!map.getLayer(layerId)) continue;
      map.on('click', layerId, select);
      map.on('mouseenter', layerId, point);
      map.on('mouseleave', layerId, clear);
    }
    return () => {
      for (const layerId of layerIds) {
        map.off('click', layerId, select);
        map.off('mouseenter', layerId, point);
        map.off('mouseleave', layerId, clear);
      }
    };
  }, [
    active,
    map,
    mapStyleRevision,
    mutationLocked,
    onSelectSegments,
    segments,
    selectedSegmentIds,
    showHiddenRoads,
  ]);
  useEffect(() => {
    if (!active || !map) return;
    const clusterId = 'streetlight-apartment-clusters';
    const circleId = 'streetlight-apartments';
    (map.getSource('streetlightApartments') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: apartmentComplexes
        .filter(({ withinBoundary }) => withinBoundary)
        .map((apartment) => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: apartment.position },
          properties: {
            id: apartment.id,
            label: 'A',
            color: apartmentMarkerColor(apartment.reviewStatus),
            selected: apartment.id === selectedApartmentId,
          },
        })),
    });
    for (const id of apartmentLayerIds) map.setLayoutProperty(id, 'visibility', 'visible');
    map.setPaintProperty(circleId, 'circle-stroke-width', ['case', ['get', 'selected'], 3, 2]);
    const select = (event: MapLayerMouseEvent) => {
      if (mutationLocked) return;
      const id = event.features?.[0]?.properties?.id;
      if (typeof id === 'string') onSelectApartment(id);
    };
    const expand = (event: MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      const id = feature?.properties?.cluster_id;
      if (typeof id !== 'number' || feature?.geometry.type !== 'Point' || mutationLocked) return;
      const source = map.getSource('streetlightApartments') as GeoJSONSource | undefined;
      if (!source) return;
      void expandApartmentCluster(source, id, feature.geometry.coordinates as Position, (camera) =>
        map.easeTo(camera),
      );
    };
    const point = () => {
      map.getCanvas().style.cursor = 'pointer';
    };
    const clear = () => {
      map.getCanvas().style.cursor = '';
    };
    map.on('click', clusterId, expand);
    map.on('click', circleId, select);
    map.on('mouseenter', clusterId, point);
    map.on('mouseenter', circleId, point);
    map.on('mouseleave', clusterId, clear);
    map.on('mouseleave', circleId, clear);
    return () => {
      map.off('click', clusterId, expand);
      map.off('click', circleId, select);
      map.off('mouseenter', clusterId, point);
      map.off('mouseenter', circleId, point);
      map.off('mouseleave', clusterId, clear);
      map.off('mouseleave', circleId, clear);
    };
  }, [
    active,
    apartmentComplexes,
    map,
    mapStyleRevision,
    mutationLocked,
    onSelectApartment,
    selectedApartmentId,
  ]);

  useEffect(() => {
    if (!active || !map || mutationLocked) return;
    const container = map.getCanvasContainer();
    const boxZoomWasEnabled = map.boxZoom.isEnabled();
    map.boxZoom.disable();
    let start: { x: number; y: number } | null = null;
    let box: HTMLDivElement | null = null;
    let dragPanWasEnabled = false;

    const point = (event: MouseEvent) => {
      const bounds = container.getBoundingClientRect();
      return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    };
    const visibleRoadLayers = () =>
      ['streetlight-coverage', 'streetlight-territory-hidden'].filter((id) => map.getLayer(id));
    const selectableIds = (bounds: [[number, number], [number, number]]) => [
      ...new Set(
        map
          .queryRenderedFeatures(bounds, { layers: visibleRoadLayers() })
          .filter(({ properties }) => properties?.selectable && typeof properties.id === 'string')
          .map(({ properties }) => properties?.id as string),
      ),
    ];
    const reset = () => {
      box?.remove();
      box = null;
      start = null;
      container.style.cursor = '';
      if (dragPanWasEnabled) map.dragPan.enable();
      dragPanWasEnabled = false;
    };
    const move = (event: MouseEvent) => {
      if (!start || !box) return;
      const current = point(event);
      box.style.left = Math.min(start.x, current.x) + 'px';
      box.style.top = Math.min(start.y, current.y) + 'px';
      box.style.width = Math.abs(current.x - start.x) + 'px';
      box.style.height = Math.abs(current.y - start.y) + 'px';
    };
    const finish = (event: MouseEvent) => {
      if (!start) return;
      const current = point(event);
      const dragged = Math.abs(current.x - start.x) >= 4 || Math.abs(current.y - start.y) >= 4;
      const ids = selectableIds([
        [Math.min(start.x, current.x), Math.min(start.y, current.y)],
        [Math.max(start.x, current.x), Math.max(start.y, current.y)],
      ]);
      if (ids.length > 0) onSelectSegments(ids, !dragged && event.shiftKey);
      reset();
      onBoxSelectionComplete();
    };
    const begin = (event: MouseEvent) => {
      if (
        event.button !== 0 ||
        mutationLockedRef.current ||
        (!event.shiftKey && !boxSelectionArmed)
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      start = point(event);
      dragPanWasEnabled = map.dragPan.isEnabled();
      map.dragPan.disable();
      box = document.createElement('div');
      box.className = 'territory-selection-box';
      container.append(box);
      container.style.cursor = 'crosshair';
    };

    if (boxSelectionArmed) container.style.cursor = 'crosshair';
    container.addEventListener('mousedown', begin, true);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', finish);
    return () => {
      container.removeEventListener('mousedown', begin, true);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', finish);
      reset();
      if (boxZoomWasEnabled) map.boxZoom.enable();
    };
  }, [active, boxSelectionArmed, map, mutationLocked, onBoxSelectionComplete, onSelectSegments]);

  return null;
}
