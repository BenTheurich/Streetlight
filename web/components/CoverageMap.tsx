'use client';

import { useEffect, useRef, useState } from 'react';
import type { CoverageWorkspaceSegment } from '@/lib/database';
import { latLng, loadGoogleMaps } from '@/lib/google-maps-browser';
import type { Position } from '@/lib/territory-geometry';
import { segmentStrokeWeight } from '@/lib/territory-map-style';

const colors = {
  red: '#B4473D',
  orange: '#D66B2D',
  yellow: '#D2A128',
  green: '#3E8B65',
  gray: '#77736C',
};

type CoverageMapProps = {
  apiKey: string;
  center: Position;
  segments: CoverageWorkspaceSegment[];
  selectedSegmentId: string | null;
  onSelectSegment: (id: string) => void;
};

export function CoverageMap({
  apiKey,
  center,
  segments,
  selectedSegmentId,
  onSelectSegment,
}: CoverageMapProps) {
  const elementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const linesRef = useRef<Array<{ id: string; line: google.maps.Polyline }>>([]);
  const fittedRef = useRef(false);
  const centerRef = useRef(center);
  const mapCenterRef = useRef<Position | null>(null);
  const selectedSegmentRef = useRef(selectedSegmentId);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(apiKey ? 'loading' : 'error');

  selectedSegmentRef.current = selectedSegmentId;
  centerRef.current = center;

  useEffect(() => {
    if (!apiKey || !elementRef.current) return;
    let disposed = false;
    loadGoogleMaps(apiKey)
      .then((maps) => {
        if (disposed || !elementRef.current) return;
        mapRef.current = new maps.Map(elementRef.current, {
          center: latLng(centerRef.current),
          zoom: 11,
          mapId: 'DEMO_MAP_ID',
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          clickableIcons: false,
        });
        fittedRef.current = false;
        mapCenterRef.current = centerRef.current;
        setStatus('ready');
      })
      .catch(() => {
        if (!disposed) setStatus('error');
      });
    return () => {
      disposed = true;
      if (mapRef.current) google.maps.event.clearInstanceListeners(mapRef.current);
      mapRef.current = null;
    };
  }, [apiKey]);

  useEffect(() => {
    const previous = mapCenterRef.current;
    if (!previous || previous[0] !== center[0] || previous[1] !== center[1]) {
      mapRef.current?.panTo(latLng(center));
      mapCenterRef.current = center;
    }
  }, [center]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready') return;
    let disposed = false;
    let marker: google.maps.marker.AdvancedMarkerElement | null = null;
    void google.maps.importLibrary('marker').then((library) => {
      if (disposed) return;
      const { AdvancedMarkerElement } = library as google.maps.MarkerLibrary;
      marker = new AdvancedMarkerElement({ map, position: latLng(center), title: 'Church' });
    });
    return () => {
      disposed = true;
      if (marker) marker.map = null;
    };
  }, [center, status]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready') return;
    const bounds = new google.maps.LatLngBounds();
    const lines = segments.map((segment) => {
      const line = new google.maps.Polyline({
        map,
        path: segment.geometry.coordinates.map(latLng),
        strokeColor: segment.eligible ? colors[segment.coverageClass] : colors.gray,
        strokeOpacity: segment.eligible ? 0.68 : 0.42,
        strokeWeight: segmentStrokeWeight(map.getZoom() ?? 11),
        clickable: segment.eligible,
        zIndex: 2,
      });
      if (segment.eligible) {
        for (const point of segment.geometry.coordinates) bounds.extend(latLng(point));
        line.addListener('click', () => onSelectSegment(segment.id));
      }
      return line;
    });
    linesRef.current = lines.map((line, index) => ({ id: segments[index].id, line }));
    const initialWeight = segmentStrokeWeight(map.getZoom() ?? 11);
    for (const { id, line } of linesRef.current) {
      const selected = id === selectedSegmentRef.current;
      line.setOptions({
        strokeWeight: initialWeight + (selected ? 2 : 0),
        zIndex: selected ? 3 : 2,
      });
    }
    if (!fittedRef.current && !bounds.isEmpty()) {
      map.fitBounds(bounds, 48);
      fittedRef.current = true;
    }
    const updateStrokeWeight = () => {
      const weight = segmentStrokeWeight(map.getZoom() ?? 11);
      for (const { id, line } of linesRef.current) {
        line.setOptions({ strokeWeight: weight + (id === selectedSegmentRef.current ? 2 : 0) });
      }
    };
    const zoomListener = map.addListener('zoom_changed', updateStrokeWeight);
    return () => {
      zoomListener.remove();
      linesRef.current = [];
      for (const line of lines) {
        google.maps.event.clearInstanceListeners(line);
        line.setMap(null);
      }
    };
  }, [onSelectSegment, segments, status]);

  useEffect(() => {
    const weight = segmentStrokeWeight(mapRef.current?.getZoom() ?? 11);
    for (const { id, line } of linesRef.current) {
      const selected = id === selectedSegmentId;
      line.setOptions({ strokeWeight: weight + (selected ? 2 : 0), zIndex: selected ? 3 : 2 });
    }
  }, [selectedSegmentId]);

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
        aria-label="Coverage heatmap"
        className="google-map"
        ref={elementRef}
        role="application"
      />
      {status === 'loading' && <span className="map-loading">Loading map…</span>}
      {status === 'error' && <span className="map-loading">Google map could not load.</span>}
      <fieldset className="map-legend coverage-legend">
        <legend className="sr-only">Coverage heatmap legend</legend>
        {Object.entries(colors).map(([name, color]) => (
          <span key={name}>
            <i style={{ background: color }} />
            {name === 'gray' ? 'Excluded' : name}
          </span>
        ))}
      </fieldset>
    </>
  );
}
