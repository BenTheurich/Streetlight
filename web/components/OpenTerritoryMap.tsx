'use client';

import type {
  GeoJSONSource,
  MapLayerMouseEvent,
  Map as MapLibreMap,
  Marker as MapLibreMarker,
  MapMouseEvent,
} from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import type { ApartmentComplex, ExclusionArea, TerritorySegment } from '@/lib/database';
import {
  type BoundaryShape,
  closePolygon,
  type Position,
  territoryBoundary,
} from '@/lib/territory-geometry';
import {
  type ApartmentSelectionSource,
  apartmentAllowsDrawingPoint,
  apartmentFocusZoom,
  apartmentLayerIds,
  apartmentMarkerColor,
  boundaryStrokePaths,
  expandApartmentCluster,
  segmentMapAppearance,
  segmentVisibleOnMap,
} from '@/lib/territory-map-style';

type OpenTerritoryMapProps = {
  active: boolean;
  map: MapLibreMap | null;
  center: Position;
  radiusMiles: number;
  boundaryShape: BoundaryShape;
  segments: TerritorySegment[];
  apartmentComplexes: ApartmentComplex[];
  exclusions: ExclusionArea[];
  mutationLocked: boolean;
  selectedExclusionId: string | null;
  selectedHiddenRoadGroupId: string | null;
  selectedSegmentId: string | null;
  showHiddenRoads: boolean;
  drawing: boolean;
  drawingPoints: Position[];
  onAddDrawingPoint: (point: Position) => void;
  onDrawingPointsChange: (points: Position[]) => void;
  onExclusionChange: (id: string, points: Position[]) => void;
  onSelectExclusion: (id: string) => void;
  onSelectHiddenRoadGroup: (id: string) => void;
  onSelectSegment: (id: string) => void;
  onSelectApartment: (id: string) => void;
  selectedApartmentId: string | null;
  selectedApartmentPosition: Position | null;
  apartmentSelectionSource: ApartmentSelectionSource | null;
};

function beforeRoadLabels(map: MapLibreMap): string | undefined {
  return map.getLayer('highway-name-minor') ? 'highway-name-minor' : undefined;
}

function midpoint(first: Position, second: Position): Position {
  return [(first[0] + second[0]) / 2, (first[1] + second[1]) / 2];
}

export function OpenTerritoryMap({
  active,
  map,
  center,
  radiusMiles,
  boundaryShape,
  segments,
  apartmentComplexes,
  exclusions,
  mutationLocked,
  selectedExclusionId,
  selectedHiddenRoadGroupId,
  selectedSegmentId,
  showHiddenRoads,
  drawing,
  drawingPoints,
  onAddDrawingPoint,
  onDrawingPointsChange,
  onExclusionChange,
  onSelectExclusion,
  onSelectHiddenRoadGroup,
  onSelectSegment,
  onSelectApartment,
  selectedApartmentId,
  selectedApartmentPosition,
  apartmentSelectionSource,
}: OpenTerritoryMapProps) {
  const drawingRef = useRef(drawing);
  const mutationLockedRef = useRef(mutationLocked);
  const addPointRef = useRef(onAddDrawingPoint);
  const previousCenterRef = useRef(center);
  drawingRef.current = drawing;
  mutationLockedRef.current = mutationLocked;
  addPointRef.current = onAddDrawingPoint;

  useEffect(() => {
    if (!active || !map) return;
    const addPoint = (event: MapMouseEvent) => {
      const apartmentHit =
        map.queryRenderedFeatures(event.point, {
          layers: apartmentLayerIds.filter((id) => map.getLayer(id)),
        }).length > 0;
      if (
        !mutationLockedRef.current &&
        drawingRef.current &&
        apartmentAllowsDrawingPoint(apartmentHit)
      ) {
        addPointRef.current([event.lngLat.lng, event.lngLat.lat]);
      }
    };
    const addCenterPoint = (event: KeyboardEvent) => {
      if (!drawingRef.current || mutationLockedRef.current || event.key !== 'Enter') return;
      const point = map.getCenter();
      event.preventDefault();
      addPointRef.current([point.lng, point.lat]);
    };
    map.on('click', addPoint);
    map.getCanvasContainer().addEventListener('keydown', addCenterPoint);
    return () => {
      map.off('click', addPoint);
      map.getCanvasContainer().removeEventListener('keydown', addCenterPoint);
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
        paint: { 'fill-color': '#df6d32', 'fill-opacity': 0.025 },
      },
      before,
    );
    map.addLayer(
      {
        id: lineLayer,
        type: 'line',
        source: lineSource,
        paint: {
          'line-color': '#df6d32',
          'line-opacity': 1,
          'line-width': 3,
          'line-dasharray': [2, 2],
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
  }, [active, map]);

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
  }, [active, boundaryShape, center, map, radiusMiles]);

  useEffect(() => {
    if (!active || !map) return;
    const layerId = 'streetlight-coverage';
    const visibleSegments = segments.filter((segment) =>
      segmentVisibleOnMap(segment, showHiddenRoads),
    );
    (map.getSource('streetlightCoverage') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: visibleSegments.map((segment) => {
        const appearance = segmentMapAppearance(
          segment,
          selectedSegmentId,
          selectedHiddenRoadGroupId,
        );
        return {
          type: 'Feature' as const,
          geometry: segment.geometry,
          properties: {
            id: segment.id,
            roadGroupId: segment.roadGroupId,
            active: segment.active,
            manuallyExcluded: segment.manuallyExcluded,
            selectable: !drawing && !mutationLocked && appearance.selectable,
            color: appearance.strokeColor,
            opacity: appearance.strokeOpacity,
            weightOffset: appearance.weightOffset,
          },
        };
      }),
    });
    map.setLayoutProperty('streetlight-coverage', 'visibility', 'visible');
    map.setPaintProperty('streetlight-coverage', 'line-width', [
      'max',
      1,
      ['+', ['interpolate', ['linear'], ['zoom'], 11, 2, 14, 5], ['get', 'weightOffset']],
    ]);
    const select = (event: MapLayerMouseEvent) => {
      if (mutationLocked) return;
      const properties = event.features?.[0]?.properties;
      if (!properties?.selectable) return;
      if (properties.active || properties.manuallyExcluded) onSelectSegment(properties.id);
      else onSelectHiddenRoadGroup(properties.roadGroupId);
    };
    const point = (event: MapLayerMouseEvent) => {
      if (event.features?.some(({ properties }) => properties?.selectable)) {
        map.getCanvas().style.cursor = 'pointer';
      }
    };
    const clear = () => {
      map.getCanvas().style.cursor = drawing ? 'crosshair' : '';
    };
    map.on('click', layerId, select);
    map.on('mouseenter', layerId, point);
    map.on('mouseleave', layerId, clear);
    return () => {
      map.off('click', layerId, select);
      map.off('mouseenter', layerId, point);
      map.off('mouseleave', layerId, clear);
    };
  }, [
    active,
    drawing,
    map,
    mutationLocked,
    onSelectHiddenRoadGroup,
    onSelectSegment,
    segments,
    selectedHiddenRoadGroupId,
    selectedSegmentId,
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
    map.setPaintProperty(circleId, 'circle-radius', ['case', ['get', 'selected'], 27, 24]);
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
      map.getCanvas().style.cursor = drawing ? 'crosshair' : '';
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
    drawing,
    map,
    mutationLocked,
    onSelectApartment,
    selectedApartmentId,
  ]);

  useEffect(() => {
    if (!active || !map) return;
    const sourceId = 'territory-exclusions';
    const fillId = 'territory-exclusions-fill';
    const lineId = 'territory-exclusions-line';
    const markers: MapLibreMarker[] = [];
    let disposed = false;
    map.addSource(sourceId, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: exclusions.map((exclusion) => ({
          type: 'Feature' as const,
          geometry: exclusion.geometry,
          properties: {
            id: exclusion.id,
            enabled: exclusion.enabled,
            selected: exclusion.id === selectedExclusionId,
          },
        })),
      },
    });
    const before = beforeRoadLabels(map);
    map.addLayer(
      {
        id: fillId,
        type: 'fill',
        source: sourceId,
        paint: {
          'fill-color': ['case', ['get', 'enabled'], '#a9403a', '#77736c'],
          'fill-opacity': ['case', ['get', 'enabled'], ['case', ['get', 'selected'], 0.3, 0.2], 0],
        },
      },
      before,
    );
    map.addLayer(
      {
        id: lineId,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': ['case', ['get', 'enabled'], '#a9403a', '#77736c'],
          'line-opacity': ['case', ['any', ['get', 'enabled'], ['get', 'selected']], 0.95, 0.5],
          'line-width': ['case', ['get', 'selected'], 3, 2],
        },
      },
      before,
    );
    const select = (event: MapLayerMouseEvent) => {
      if (mutationLocked) return;
      const id = event.features?.[0]?.properties?.id;
      if (typeof id === 'string') onSelectExclusion(id);
    };
    map.on('click', fillId, select);
    map.on('click', lineId, select);
    const selected = exclusions.find(({ id }) => id === selectedExclusionId);
    if (selected && !drawing && !mutationLocked) {
      const points = selected.geometry.coordinates[0].slice(0, -1);
      const preview = (nextPoints: Position[]) => {
        (map.getSource(sourceId) as GeoJSONSource | undefined)?.setData({
          type: 'FeatureCollection',
          features: exclusions.map((exclusion) => ({
            type: 'Feature' as const,
            geometry: exclusion.id === selected.id ? closePolygon(nextPoints) : exclusion.geometry,
            properties: {
              id: exclusion.id,
              enabled: exclusion.enabled,
              selected: exclusion.id === selectedExclusionId,
            },
          })),
        });
      };
      void import('maplibre-gl').then(({ Marker }) => {
        if (disposed) return;
        points.forEach((point, index) => {
          const element = document.createElement('button');
          element.className = 'map-edit-vertex';
          element.type = 'button';
          element.ariaLabel = `Move vertex ${index + 1}`;
          const marker = new Marker({ draggable: true, element }).setLngLat(point).addTo(map);
          const updateVertex = () => {
            const next = [...points];
            const moved = marker.getLngLat();
            next[index] = [moved.lng, moved.lat];
            preview(next);
            return next;
          };
          marker.on('drag', () => {
            if (mutationLockedRef.current) return;
            updateVertex();
          });
          marker.on('dragend', () => {
            if (mutationLockedRef.current) return;
            onExclusionChange(selected.id, updateVertex());
          });
          markers.push(marker);

          const nextIndex = (index + 1) % points.length;
          const midpointElement = document.createElement('button');
          midpointElement.className = 'map-edit-midpoint';
          midpointElement.type = 'button';
          midpointElement.ariaLabel = `Add vertex after ${index + 1}`;
          const midpointMarker = new Marker({ draggable: true, element: midpointElement })
            .setLngLat(midpoint(point, points[nextIndex]))
            .addTo(map);
          const updateMidpoint = () => {
            const inserted = midpointMarker.getLngLat();
            const next = [...points];
            next.splice(index + 1, 0, [inserted.lng, inserted.lat]);
            preview(next);
            return next;
          };
          midpointMarker.on('drag', () => {
            if (mutationLockedRef.current) return;
            updateMidpoint();
          });
          midpointMarker.on('dragend', () => {
            if (mutationLockedRef.current) return;
            onExclusionChange(selected.id, updateMidpoint());
          });
          markers.push(midpointMarker);
        });
      });
    }
    return () => {
      disposed = true;
      map.off('click', fillId, select);
      map.off('click', lineId, select);
      for (const marker of markers) marker.remove();
      if (map.getLayer(lineId)) map.removeLayer(lineId);
      if (map.getLayer(fillId)) map.removeLayer(fillId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    };
  }, [
    active,
    drawing,
    exclusions,
    map,
    mutationLocked,
    onExclusionChange,
    onSelectExclusion,
    selectedExclusionId,
  ]);

  useEffect(() => {
    if (!active || !map) return;
    map.getCanvas().style.cursor = drawing ? 'crosshair' : '';
    if (drawingPoints.length === 0)
      return () => {
        map.getCanvas().style.cursor = '';
      };
    const sourceId = 'territory-drawing';
    const lineId = 'territory-drawing-line';
    const markers: MapLibreMarker[] = [];
    let disposed = false;
    const geometry = { type: 'LineString' as const, coordinates: drawingPoints };
    map.addSource(sourceId, {
      type: 'geojson',
      data: { type: 'Feature', properties: {}, geometry },
    });
    const before = beforeRoadLabels(map);
    map.addLayer(
      {
        id: lineId,
        type: 'line',
        source: sourceId,
        paint: { 'line-color': '#a9403a', 'line-opacity': 1, 'line-width': 3 },
      },
      before,
    );
    if (!mutationLocked) {
      void import('maplibre-gl').then(({ Marker }) => {
        if (disposed) return;
        drawingPoints.forEach((point, index) => {
          const element = document.createElement('button');
          element.className = 'map-edit-vertex';
          element.type = 'button';
          element.ariaLabel = `Move drawing vertex ${index + 1}`;
          const marker = new Marker({ draggable: true, element }).setLngLat(point).addTo(map);
          const update = () => {
            const moved = marker.getLngLat();
            const next = [...drawingPoints];
            next[index] = [moved.lng, moved.lat];
            (map.getSource(sourceId) as GeoJSONSource | undefined)?.setData({
              type: 'Feature',
              properties: {},
              geometry: { type: 'LineString', coordinates: next },
            });
            return next;
          };
          marker.on('drag', () => {
            if (mutationLockedRef.current) return;
            update();
          });
          marker.on('dragend', () => {
            if (mutationLockedRef.current) return;
            onDrawingPointsChange(update());
          });
          markers.push(marker);
        });
      });
    }
    return () => {
      disposed = true;
      map.getCanvas().style.cursor = '';
      for (const marker of markers) marker.remove();
      if (map.getLayer(lineId)) map.removeLayer(lineId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    };
  }, [active, drawing, drawingPoints, map, mutationLocked, onDrawingPointsChange]);

  return null;
}
