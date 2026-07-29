'use client';

import { useEffect, useRef } from 'react';
import type { ApartmentComplex, ExclusionArea, TerritorySegment } from '@/lib/database';
import { latLng } from '@/lib/google-maps-browser';
import { type BoundaryShape, type Position, territoryBoundary } from '@/lib/territory-geometry';
import {
  apartmentMarkerColor,
  boundaryStrokePaths,
  segmentMapAppearance,
  segmentStrokeWeight,
  segmentVisibleOnMap,
} from '@/lib/territory-map-style';

function positions(path: google.maps.MVCArray<google.maps.LatLng>): Position[] {
  return path.getArray().map((point) => [point.lng(), point.lat()]);
}

function samePositions(first: Position[], second: Position[]): boolean {
  return (
    first.length === second.length &&
    first.every(([firstLng, firstLat], index) => {
      const [secondLng, secondLat] = second[index];
      return firstLng === secondLng && firstLat === secondLat;
    })
  );
}

type TerritoryMapProps = {
  active: boolean;
  map: google.maps.Map | null;
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

export function TerritoryMap({
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
}: TerritoryMapProps) {
  const drawingRef = useRef(drawing);
  const drawingPointsRef = useRef(drawingPoints);
  const drawingPathRef = useRef<google.maps.MVCArray<google.maps.LatLng> | null>(null);
  const syncingDrawingPathRef = useRef(false);
  const addPointRef = useRef(onAddDrawingPoint);
  const drawingPointsChangeRef = useRef(onDrawingPointsChange);
  const previousCenterRef = useRef(center);
  const drawingShapeKind =
    drawing && drawingPoints.length > 0 ? (drawingPoints.length < 3 ? 'line' : 'polygon') : null;

  drawingRef.current = drawing;
  drawingPointsRef.current = drawingPoints;
  addPointRef.current = onAddDrawingPoint;
  drawingPointsChangeRef.current = onDrawingPointsChange;

  useEffect(() => {
    if (!active || !map) return;
    const clickListener = map.addListener('click', (event: google.maps.MapMouseEvent) => {
      if (drawingRef.current && event.latLng) {
        addPointRef.current([event.latLng.lng(), event.latLng.lat()]);
      }
    });
    const mapElement = map.getDiv();
    const addCenterPoint = (event: KeyboardEvent) => {
      if (drawingRef.current && event.key === 'Enter') {
        const point = map.getCenter();
        if (point) {
          event.preventDefault();
          addPointRef.current([point.lng(), point.lat()]);
        }
      }
    };
    mapElement.addEventListener('keydown', addCenterPoint);
    return () => {
      clickListener.remove();
      mapElement.removeEventListener('keydown', addCenterPoint);
    };
  }, [active, map]);

  useEffect(() => {
    const previous = previousCenterRef.current;
    previousCenterRef.current = center;
    if (active && map && (previous[0] !== center[0] || previous[1] !== center[1])) {
      map.panTo(latLng(center));
    }
  }, [active, center, map]);

  useEffect(() => {
    if (!active || !map) {
      return;
    }
    const boundary = territoryBoundary(center, radiusMiles, boundaryShape);
    const fill = new google.maps.Polygon({
      map,
      paths: boundary.coordinates[0].map(latLng),
      fillColor: '#df6d32',
      fillOpacity: 0.025,
      strokeOpacity: 0,
      clickable: false,
    });
    const rings = boundaryStrokePaths(boundary.coordinates[0], boundaryShape).map(
      (path) =>
        new google.maps.Polyline({
          map,
          path: path.map(latLng),
          strokeOpacity: 0,
          clickable: false,
          icons: [
            {
              icon: {
                path: 'M 0,-1 0,1',
                strokeColor: '#df6d32',
                strokeOpacity: 1,
                strokeWeight: 3,
              },
              offset: boundaryShape === 'square' ? '6px' : '0',
              repeat: '12px',
            },
          ],
        }),
    );
    return () => {
      fill.setMap(null);
      for (const ring of rings) ring.setMap(null);
    };
  }, [active, boundaryShape, center, map, radiusMiles]);

  useEffect(() => {
    if (!active || !map) return;
    const visibleSegments = segments.filter((segment) =>
      segmentVisibleOnMap(segment, showHiddenRoads),
    );
    const lines = visibleSegments.map((segment) => {
      const appearance = segmentMapAppearance(
        segment,
        selectedSegmentId,
        selectedHiddenRoadGroupId,
      );
      const strokeWeight = segmentStrokeWeight(map.getZoom() ?? 11);
      const line = new google.maps.Polyline({
        map,
        path: segment.geometry.coordinates.map(latLng),
        strokeColor: appearance.strokeColor,
        strokeOpacity: appearance.strokeOpacity,
        strokeWeight: Math.max(1, strokeWeight + appearance.weightOffset),
        clickable: !drawing && appearance.selectable,
        zIndex: appearance.zIndex,
      });
      if (!drawing && appearance.selectable) {
        line.addListener('click', () =>
          segment.active || segment.manuallyExcluded
            ? onSelectSegment(segment.id)
            : onSelectHiddenRoadGroup(segment.roadGroupId),
        );
      }
      return { line, segment };
    });
    const updateStrokeWeight = () => {
      const strokeWeight = segmentStrokeWeight(map.getZoom() ?? 11);
      for (const { line, segment } of lines) {
        const appearance = segmentMapAppearance(
          segment,
          selectedSegmentId,
          selectedHiddenRoadGroupId,
        );
        line.setOptions({
          strokeWeight: Math.max(1, strokeWeight + appearance.weightOffset),
        });
      }
    };
    const zoomListener = map.addListener('zoom_changed', updateStrokeWeight);
    return () => {
      zoomListener.remove();
      for (const { line } of lines) {
        google.maps.event.clearInstanceListeners(line);
        line.setMap(null);
      }
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
    let disposed = false;
    const markers: google.maps.marker.AdvancedMarkerElement[] = [];
    void google.maps.importLibrary('marker').then((library) => {
      if (disposed) return;
      const { AdvancedMarkerElement } = library as google.maps.MarkerLibrary;
      for (const apartment of apartmentComplexes.filter(({ withinBoundary }) => withinBoundary)) {
        const content = document.createElement('span');
        content.className = `apartment-map-marker${
          apartment.id === selectedApartmentId ? ' selected' : ''
        }`;
        content.style.setProperty(
          '--apartment-color',
          apartmentMarkerColor(apartment.reviewStatus),
        );
        content.textContent = 'A';
        content.title = apartment.address ?? 'Apartment complex';
        const marker = new AdvancedMarkerElement({
          map,
          position: latLng(apartment.position),
          content,
          title: apartment.address ?? 'Apartment complex',
          zIndex: apartment.id === selectedApartmentId ? 30 : 20,
          gmpClickable: true,
        });
        marker.addEventListener('gmp-click', () => onSelectApartment(apartment.id));
        markers.push(marker);
      }
    });
    return () => {
      disposed = true;
      for (const marker of markers) marker.map = null;
    };
  }, [active, apartmentComplexes, map, onSelectApartment, selectedApartmentId]);

  useEffect(() => {
    if (!active || !map) return;
    const polygons = exclusions.map((exclusion) => {
      const editable = exclusion.id === selectedExclusionId && !drawing;
      const enabled = exclusion.enabled;
      const polygon = new google.maps.Polygon({
        map,
        paths: exclusion.geometry.coordinates[0].slice(0, -1).map(latLng),
        fillColor: enabled ? '#a9403a' : '#77736c',
        fillOpacity: enabled ? (editable ? 0.3 : 0.2) : 0,
        strokeColor: enabled ? '#a9403a' : '#77736c',
        strokeOpacity: enabled || editable ? 0.95 : 0.5,
        strokeWeight: editable ? 3 : 2,
        editable,
        clickable: true,
        zIndex: editable ? 4 : enabled ? 3 : 2,
      });
      polygon.addListener('click', () => onSelectExclusion(exclusion.id));
      if (editable) {
        const path = polygon.getPath();
        const update = () => onExclusionChange(exclusion.id, positions(path));
        path.addListener('set_at', update);
        path.addListener('insert_at', update);
        path.addListener('remove_at', update);
      }
      return polygon;
    });
    return () => {
      for (const polygon of polygons) {
        google.maps.event.clearInstanceListeners(polygon);
        google.maps.event.clearInstanceListeners(polygon.getPath());
        polygon.setMap(null);
      }
    };
  }, [active, drawing, exclusions, map, onExclusionChange, onSelectExclusion, selectedExclusionId]);

  useEffect(() => {
    if (!active || !map) return;
    map.setOptions({ draggableCursor: drawing ? 'crosshair' : null });
    return () => map.setOptions({ draggableCursor: null });
  }, [active, drawing, map]);

  useEffect(() => {
    if (!active || !map || !drawingShapeKind) return;
    const shape =
      drawingShapeKind === 'line'
        ? new google.maps.Polyline({
            map,
            path: drawingPointsRef.current.map(latLng),
            strokeColor: '#a9403a',
            strokeOpacity: 0.95,
            strokeWeight: 3,
            editable: true,
            draggable: true,
            zIndex: 4,
          })
        : new google.maps.Polygon({
            map,
            paths: drawingPointsRef.current.map(latLng),
            fillColor: '#a9403a',
            fillOpacity: 0.25,
            strokeColor: '#a9403a',
            strokeOpacity: 1,
            strokeWeight: 3,
            editable: true,
            draggable: true,
            zIndex: 4,
          });
    const path = shape.getPath();
    const update = () => {
      if (syncingDrawingPathRef.current) {
        return;
      }
      const nextPoints = positions(path);
      if (!samePositions(nextPoints, drawingPointsRef.current)) {
        drawingPointsRef.current = nextPoints;
        drawingPointsChangeRef.current(nextPoints);
      }
    };
    const listeners = [
      path.addListener('set_at', update),
      path.addListener('insert_at', update),
      path.addListener('remove_at', update),
      shape.addListener('dragend', update),
    ];
    drawingPathRef.current = path;
    return () => {
      for (const listener of listeners) {
        listener.remove();
      }
      if (drawingPathRef.current === path) {
        drawingPathRef.current = null;
      }
      shape.setMap(null);
    };
  }, [active, drawingShapeKind, map]);

  useEffect(() => {
    const path = drawingPathRef.current;
    if (!path || !drawingShapeKind || samePositions(positions(path), drawingPoints)) {
      return;
    }
    syncingDrawingPathRef.current = true;
    path.clear();
    for (const point of drawingPoints) {
      path.push(new google.maps.LatLng(point[1], point[0]));
    }
    syncingDrawingPathRef.current = false;
  }, [drawingPoints, drawingShapeKind]);

  return null;
}
