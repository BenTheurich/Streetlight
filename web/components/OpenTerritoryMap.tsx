'use client';

import type { MapLayerMouseEvent, Map as MapLibreMap, Marker as MapLibreMarker } from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import type { ApartmentComplex, ExclusionArea, TerritorySegment } from '@/lib/database';
import {
  type BoundaryShape,
  closePolygon,
  type Position,
  territoryBoundary,
} from '@/lib/territory-geometry';
import {
  apartmentMarkerColor,
  boundaryStrokePaths,
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
}: OpenTerritoryMapProps) {
  const drawingRef = useRef(drawing);
  const addPointRef = useRef(onAddDrawingPoint);
  const previousCenterRef = useRef(center);
  drawingRef.current = drawing;
  addPointRef.current = onAddDrawingPoint;

  useEffect(() => {
    if (!active || !map) return;
    const addPoint = (event: { lngLat: { lng: number; lat: number } }) => {
      if (drawingRef.current) addPointRef.current([event.lngLat.lng, event.lngLat.lat]);
    };
    const addCenterPoint = (event: KeyboardEvent) => {
      if (!drawingRef.current || event.key !== 'Enter') return;
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
    if (!active || !map) return;
    const fillSource = 'territory-boundary-fill';
    const lineSource = 'territory-boundary-line';
    const fillLayer = 'territory-boundary-fill';
    const lineLayer = 'territory-boundary-line';
    const boundary = territoryBoundary(center, radiusMiles, boundaryShape);
    map.addSource(fillSource, {
      type: 'geojson',
      data: { type: 'Feature', properties: {}, geometry: boundary },
    });
    map.addSource(lineSource, {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'MultiLineString',
          coordinates: boundaryStrokePaths(boundary.coordinates[0], boundaryShape),
        },
      },
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
  }, [active, boundaryShape, center, map, radiusMiles]);

  useEffect(() => {
    if (!active || !map) return;
    const sourceId = 'territory-segments';
    const layerId = 'territory-segments';
    const visibleSegments = segments.filter((segment) =>
      segmentVisibleOnMap(segment, showHiddenRoads),
    );
    map.addSource(sourceId, {
      type: 'geojson',
      data: {
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
              selectable: !drawing && appearance.selectable,
              color: appearance.strokeColor,
              opacity: appearance.strokeOpacity,
              weightOffset: appearance.weightOffset,
              sort: appearance.zIndex,
            },
          };
        }),
      },
    });
    map.addLayer(
      {
        id: layerId,
        type: 'line',
        source: sourceId,
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
          'line-sort-key': ['get', 'sort'],
        },
        paint: {
          'line-color': ['get', 'color'],
          'line-opacity': ['get', 'opacity'],
          'line-width': [
            'max',
            1,
            ['+', ['interpolate', ['linear'], ['zoom'], 11, 2, 14, 5], ['get', 'weightOffset']],
          ],
        },
      },
      beforeRoadLabels(map),
    );
    const select = (event: MapLayerMouseEvent) => {
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
      if (map.getLayer(layerId)) map.removeLayer(layerId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    };
  }, [
    active,
    drawing,
    map,
    onSelectHiddenRoadGroup,
    onSelectSegment,
    segments,
    selectedHiddenRoadGroupId,
    selectedSegmentId,
    showHiddenRoads,
  ]);

  useEffect(() => {
    if (!active || !map) return;
    const sourceId = 'territory-apartments';
    const circleId = 'territory-apartments';
    const labelId = 'territory-apartment-labels';
    map.addSource(sourceId, {
      type: 'geojson',
      data: {
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
      },
    });
    const before = beforeRoadLabels(map);
    map.addLayer(
      {
        id: circleId,
        type: 'circle',
        source: sourceId,
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': ['case', ['get', 'selected'], 13, 10],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': ['case', ['get', 'selected'], 3, 2],
        },
      },
      before,
    );
    map.addLayer(
      {
        id: labelId,
        type: 'symbol',
        source: sourceId,
        layout: {
          'text-field': ['get', 'label'],
          'text-size': 11,
          'text-font': ['Noto Sans Bold'],
        },
        paint: { 'text-color': '#ffffff' },
      },
      before,
    );
    const select = (event: MapLayerMouseEvent) => {
      const id = event.features?.[0]?.properties?.id;
      if (typeof id === 'string') onSelectApartment(id);
    };
    const point = () => {
      map.getCanvas().style.cursor = 'pointer';
    };
    const clear = () => {
      map.getCanvas().style.cursor = drawing ? 'crosshair' : '';
    };
    map.on('click', circleId, select);
    map.on('mouseenter', circleId, point);
    map.on('mouseleave', circleId, clear);
    return () => {
      map.off('click', circleId, select);
      map.off('mouseenter', circleId, point);
      map.off('mouseleave', circleId, clear);
      if (map.getLayer(labelId)) map.removeLayer(labelId);
      if (map.getLayer(circleId)) map.removeLayer(circleId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    };
  }, [active, apartmentComplexes, drawing, map, onSelectApartment, selectedApartmentId]);

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
      const id = event.features?.[0]?.properties?.id;
      if (typeof id === 'string') onSelectExclusion(id);
    };
    map.on('click', fillId, select);
    map.on('click', lineId, select);
    const selected = exclusions.find(({ id }) => id === selectedExclusionId);
    if (selected && !drawing) {
      const points = selected.geometry.coordinates[0].slice(0, -1);
      void import('maplibre-gl').then(({ Marker }) => {
        if (disposed) return;
        points.forEach((point, index) => {
          const element = document.createElement('button');
          element.className = 'map-edit-vertex';
          element.type = 'button';
          element.ariaLabel = `Move vertex ${index + 1}`;
          const marker = new Marker({ draggable: true, element }).setLngLat(point).addTo(map);
          marker.on('dragend', () => {
            const next = [...points];
            const moved = marker.getLngLat();
            next[index] = [moved.lng, moved.lat];
            onExclusionChange(selected.id, next);
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
          midpointMarker.on('dragend', () => {
            const inserted = midpointMarker.getLngLat();
            const next = [...points];
            next.splice(index + 1, 0, [inserted.lng, inserted.lat]);
            onExclusionChange(selected.id, next);
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
  }, [active, drawing, exclusions, map, onExclusionChange, onSelectExclusion, selectedExclusionId]);

  useEffect(() => {
    if (!active || !map) return;
    map.getCanvas().style.cursor = drawing ? 'crosshair' : '';
    if (drawingPoints.length === 0)
      return () => {
        map.getCanvas().style.cursor = '';
      };
    const sourceId = 'territory-drawing';
    const fillId = 'territory-drawing-fill';
    const lineId = 'territory-drawing-line';
    const markers: MapLibreMarker[] = [];
    let disposed = false;
    const geometry =
      drawingPoints.length >= 3
        ? closePolygon(drawingPoints)
        : { type: 'LineString' as const, coordinates: drawingPoints };
    map.addSource(sourceId, {
      type: 'geojson',
      data: { type: 'Feature', properties: {}, geometry },
    });
    const before = beforeRoadLabels(map);
    map.addLayer(
      {
        id: fillId,
        type: 'fill',
        source: sourceId,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': '#a9403a', 'fill-opacity': 0.25 },
      },
      before,
    );
    map.addLayer(
      {
        id: lineId,
        type: 'line',
        source: sourceId,
        paint: { 'line-color': '#a9403a', 'line-opacity': 1, 'line-width': 3 },
      },
      before,
    );
    void import('maplibre-gl').then(({ Marker }) => {
      if (disposed) return;
      drawingPoints.forEach((point, index) => {
        const element = document.createElement('button');
        element.className = 'map-edit-vertex';
        element.type = 'button';
        element.ariaLabel = `Move drawing vertex ${index + 1}`;
        const marker = new Marker({ draggable: true, element }).setLngLat(point).addTo(map);
        marker.on('dragend', () => {
          const moved = marker.getLngLat();
          const next = [...drawingPoints];
          next[index] = [moved.lng, moved.lat];
          onDrawingPointsChange(next);
        });
        markers.push(marker);
      });
    });
    return () => {
      disposed = true;
      map.getCanvas().style.cursor = '';
      for (const marker of markers) marker.remove();
      if (map.getLayer(lineId)) map.removeLayer(lineId);
      if (map.getLayer(fillId)) map.removeLayer(fillId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    };
  }, [active, drawing, drawingPoints, map, onDrawingPointsChange]);

  return null;
}
