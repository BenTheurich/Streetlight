'use client';

import { useEffect, useRef, useState } from 'react';
import type { ExclusionArea, TerritorySegment } from '@/lib/database';
import { circleBoundary, type Position } from '@/lib/territory-geometry';
import { segmentStrokeWeight } from '@/lib/territory-map-style';

let mapsPromise: Promise<typeof google.maps> | undefined;

function loadGoogleMaps(apiKey: string): Promise<typeof google.maps> {
  if (window.google?.maps) {
    return Promise.resolve(window.google.maps);
  }
  if (!mapsPromise) {
    mapsPromise = new Promise((resolve, reject) => {
      const callbackName = '__streetlightGoogleMapsReady';
      const callbackWindow = window as typeof window & {
        __streetlightGoogleMapsReady?: () => void;
      };
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&loading=async&libraries=marker&callback=${callbackName}`;
      script.async = true;
      callbackWindow.__streetlightGoogleMapsReady = () => {
        delete callbackWindow.__streetlightGoogleMapsReady;
        resolve(window.google.maps);
      };
      script.onerror = () => reject(new Error('Map unavailable'));
      document.head.append(script);
    });
  }
  return mapsPromise;
}

function latLng(position: Position): google.maps.LatLngLiteral {
  return { lat: position[1], lng: position[0] };
}

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
  apiKey: string;
  center: Position;
  radiusMiles: number;
  segments: TerritorySegment[];
  exclusions: ExclusionArea[];
  selectedExclusionId: string | null;
  drawing: boolean;
  drawingPoints: Position[];
  onAddDrawingPoint: (point: Position) => void;
  onDrawingPointsChange: (points: Position[]) => void;
  onExclusionChange: (id: string, points: Position[]) => void;
  onSelectExclusion: (id: string) => void;
};

export function TerritoryMap({
  apiKey,
  center,
  radiusMiles,
  segments,
  exclusions,
  selectedExclusionId,
  drawing,
  drawingPoints,
  onAddDrawingPoint,
  onDrawingPointsChange,
  onExclusionChange,
  onSelectExclusion,
}: TerritoryMapProps) {
  const elementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const centerRef = useRef(center);
  const drawingRef = useRef(drawing);
  const drawingPointsRef = useRef(drawingPoints);
  const addPointRef = useRef(onAddDrawingPoint);
  const drawingPointsChangeRef = useRef(onDrawingPointsChange);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(apiKey ? 'loading' : 'error');

  centerRef.current = center;
  drawingRef.current = drawing;
  drawingPointsRef.current = drawingPoints;
  addPointRef.current = onAddDrawingPoint;
  drawingPointsChangeRef.current = onDrawingPointsChange;

  useEffect(() => {
    if (!apiKey || !elementRef.current) {
      return;
    }
    let disposed = false;
    loadGoogleMaps(apiKey)
      .then((maps) => {
        if (disposed || !elementRef.current) {
          return;
        }
        const map = new maps.Map(elementRef.current, {
          center: latLng(centerRef.current),
          zoom: 11,
          mapId: 'DEMO_MAP_ID',
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          clickableIcons: false,
        });
        map.addListener('click', (event: google.maps.MapMouseEvent) => {
          if (drawingRef.current && event.latLng) {
            addPointRef.current([event.latLng.lng(), event.latLng.lat()]);
          }
        });
        mapRef.current = map;
        setStatus('ready');
      })
      .catch(() => {
        if (!disposed) {
          setStatus('error');
        }
      });
    return () => {
      disposed = true;
      if (mapRef.current) {
        google.maps.event.clearInstanceListeners(mapRef.current);
      }
      mapRef.current = null;
    };
  }, [apiKey]);

  useEffect(() => {
    mapRef.current?.panTo(latLng(center));
  }, [center]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready') {
      return;
    }
    let disposed = false;
    let marker: google.maps.marker.AdvancedMarkerElement | null = null;
    void google.maps.importLibrary('marker').then((library) => {
      if (disposed) {
        return;
      }
      const { AdvancedMarkerElement } = library as google.maps.MarkerLibrary;
      marker = new AdvancedMarkerElement({
        map,
        position: latLng(center),
        title: 'Church',
      });
    });
    return () => {
      disposed = true;
      if (marker) {
        marker.map = null;
      }
    };
  }, [center, status]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready') {
      return;
    }
    const fill = new google.maps.Circle({
      map,
      center: latLng(center),
      radius: radiusMiles * 1609.344,
      fillColor: '#df6d32',
      fillOpacity: 0.025,
      strokeOpacity: 0,
      clickable: false,
    });
    const ring = new google.maps.Polyline({
      map,
      path: circleBoundary(center, radiusMiles).coordinates[0].map(latLng),
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
          offset: '0',
          repeat: '12px',
        },
      ],
    });
    return () => {
      fill.setMap(null);
      ring.setMap(null);
    };
  }, [center, radiusMiles, status]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready') {
      return;
    }
    const lines = segments.map(
      (segment) =>
        new google.maps.Polyline({
          map,
          path: segment.geometry.coordinates.map(latLng),
          strokeColor: segment.eligible ? '#df6d32' : '#77736c',
          strokeOpacity: segment.eligible ? 0.65 : 0.5,
          strokeWeight: segmentStrokeWeight(map.getZoom() ?? 11),
          clickable: false,
          zIndex: 2,
        }),
    );
    const updateStrokeWeight = () => {
      const strokeWeight = segmentStrokeWeight(map.getZoom() ?? 11);
      for (const line of lines) {
        line.setOptions({ strokeWeight });
      }
    };
    const zoomListener = map.addListener('zoom_changed', updateStrokeWeight);
    return () => {
      zoomListener.remove();
      for (const line of lines) {
        line.setMap(null);
      }
    };
  }, [segments, status]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready') {
      return;
    }
    const polygons = exclusions.map((exclusion) => {
      const editable = exclusion.id === selectedExclusionId && !drawing;
      const polygon = new google.maps.Polygon({
        map,
        paths: exclusion.geometry.coordinates[0].slice(0, -1).map(latLng),
        fillColor: '#a9403a',
        fillOpacity: editable ? 0.3 : 0.2,
        strokeColor: '#a9403a',
        strokeOpacity: 0.95,
        strokeWeight: editable ? 3 : 2,
        editable,
        clickable: true,
        zIndex: 3,
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
  }, [drawing, exclusions, onExclusionChange, onSelectExclusion, selectedExclusionId, status]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready') {
      return;
    }
    map.setOptions({ draggableCursor: drawing ? 'crosshair' : null });
    return () => map.setOptions({ draggableCursor: null });
  }, [drawing, status]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready' || !drawing || drawingPoints.length === 0) {
      return;
    }
    const shape =
      drawingPoints.length < 3
        ? new google.maps.Polyline({
            map,
            path: drawingPoints.map(latLng),
            strokeColor: '#a9403a',
            strokeOpacity: 0.95,
            strokeWeight: 3,
            editable: true,
            draggable: true,
            zIndex: 4,
          })
        : new google.maps.Polygon({
            map,
            paths: drawingPoints.map(latLng),
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
    return () => {
      for (const listener of listeners) {
        listener.remove();
      }
      shape.setMap(null);
    };
  }, [drawing, drawingPoints, status]);

  if (!apiKey) {
    return (
      <div className="map-unavailable" role="status">
        <strong>Interactive map unavailable</strong>
        <span>Add the browser map key described in ENVIRONMENTS.md.</span>
      </div>
    );
  }

  return (
    <>
      <div
        aria-label="Interactive outreach territory map"
        className="google-map"
        onKeyDown={(event) => {
          if (drawing && event.key === 'Enter' && mapRef.current?.getCenter()) {
            event.preventDefault();
            const point = mapRef.current.getCenter();
            if (point) {
              onAddDrawingPoint([point.lng(), point.lat()]);
            }
          }
        }}
        ref={elementRef}
        role="application"
      />
      {status === 'loading' && <span className="map-loading">Loading map…</span>}
      {status === 'error' && <span className="map-loading">Google map could not load.</span>}
    </>
  );
}
