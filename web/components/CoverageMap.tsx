'use client';

import { useEffect, useRef } from 'react';
import type { CoverageLegendItem } from '@/lib/coverage';
import type { ApartmentComplex, CoverageWorkspaceSegment } from '@/lib/database';
import { latLng } from '@/lib/google-maps-browser';
import { apartmentMarkerColor, segmentStrokeWeight } from '@/lib/territory-map-style';

export const coverageColors = {
  red: '#B4473D',
  orange: '#D66B2D',
  yellow: '#D2A128',
  green: '#3E8B65',
  gray: '#77736C',
};

type CoverageMapProps = {
  active: boolean;
  interactive: boolean;
  map: google.maps.Map | null;
  legend: CoverageLegendItem[];
  segments: CoverageWorkspaceSegment[];
  apartmentComplexes: ApartmentComplex[];
  selectedSegmentId: string | null;
  onSelectSegment: (id: string) => void;
};

export function CoverageMap({
  active,
  interactive,
  map,
  legend,
  segments,
  apartmentComplexes,
  selectedSegmentId,
  onSelectSegment,
}: CoverageMapProps) {
  const linesRef = useRef<Array<{ id: string; line: google.maps.Polyline }>>([]);
  const fittedRef = useRef(false);
  const selectedSegmentRef = useRef(selectedSegmentId);

  selectedSegmentRef.current = selectedSegmentId;

  useEffect(() => {
    if (!active || !map) return;
    const bounds = new google.maps.LatLngBounds();
    const lines = segments.map((segment) => {
      const line = new google.maps.Polyline({
        map,
        path: segment.geometry.coordinates.map(latLng),
        strokeColor: segment.eligible ? coverageColors[segment.coverageClass] : coverageColors.gray,
        strokeOpacity: segment.eligible ? 0.68 : 0.42,
        strokeWeight: segmentStrokeWeight(map.getZoom() ?? 11),
        clickable: interactive,
        zIndex: 2,
      });
      for (const point of segment.geometry.coordinates) bounds.extend(latLng(point));
      if (interactive) line.addListener('click', () => onSelectSegment(segment.id));
      return line;
    });
    linesRef.current = lines.map((line, index) => ({ id: segments[index].id, line }));
    const initialWeight = segmentStrokeWeight(map.getZoom() ?? 11);
    for (const { id, line } of linesRef.current) {
      const selected = interactive && id === selectedSegmentRef.current;
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
        line.setOptions({
          strokeWeight: weight + (interactive && id === selectedSegmentRef.current ? 2 : 0),
        });
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
  }, [active, interactive, map, onSelectSegment, segments]);

  useEffect(() => {
    if (!active || !map) return;
    let disposed = false;
    const markers: google.maps.marker.AdvancedMarkerElement[] = [];
    void google.maps.importLibrary('marker').then((library) => {
      if (disposed) return;
      const { AdvancedMarkerElement } = library as google.maps.MarkerLibrary;
      for (const apartment of apartmentComplexes) {
        const content = document.createElement('span');
        content.className = 'apartment-map-marker static';
        content.style.setProperty(
          '--apartment-color',
          apartmentMarkerColor(apartment.reviewStatus),
        );
        content.textContent = 'A';
        const marker = new AdvancedMarkerElement({
          map,
          position: latLng(apartment.position),
          content,
          title: `${apartment.address ?? 'Apartment complex'} · ${apartment.reviewStatus.replace('_', ' ')}`,
          zIndex: 8,
        });
        markers.push(marker);
      }
    });
    return () => {
      disposed = true;
      for (const marker of markers) marker.map = null;
    };
  }, [active, apartmentComplexes, map]);

  useEffect(() => {
    if (!interactive) return;
    const weight = segmentStrokeWeight(map?.getZoom() ?? 11);
    for (const { id, line } of linesRef.current) {
      const selected = id === selectedSegmentId;
      line.setOptions({ strokeWeight: weight + (selected ? 2 : 0), zIndex: selected ? 3 : 2 });
    }
  }, [interactive, map, selectedSegmentId]);

  if (!active) return null;

  return (
    <fieldset className="map-legend coverage-legend">
      <legend className="sr-only">Coverage heatmap legend</legend>
      {legend.map((item) => (
        <span key={item.coverageClass}>
          <i style={{ background: coverageColors[item.coverageClass] }} />
          {item.label}
        </span>
      ))}
    </fieldset>
  );
}
