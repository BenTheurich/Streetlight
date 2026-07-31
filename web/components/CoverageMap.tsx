'use client';

import { useEffect, useRef } from 'react';
import type { CoverageLegendItem } from '@/lib/coverage';
import type { CoverageWorkspaceApartment, CoverageWorkspaceSegment } from '@/lib/database';
import { latLng } from '@/lib/google-maps-browser';
import {
  apartmentMarkerColor,
  coverageColors,
  segmentStrokeWeight,
} from '@/lib/territory-map-style';

type CoverageMapProps = {
  active: boolean;
  interactive: boolean;
  map: google.maps.Map | null;
  legend: CoverageLegendItem[];
  segments: CoverageWorkspaceSegment[];
  apartmentComplexes: CoverageWorkspaceApartment[];
  selectedSegmentId: string | null;
  onEditHeatmapRanges: () => void;
  onSelectSegment: (id: string) => void;
  fitOnMount?: boolean;
};

export function CoverageMap({
  active,
  interactive,
  map,
  legend,
  segments,
  apartmentComplexes,
  selectedSegmentId,
  onEditHeatmapRanges,
  onSelectSegment,
  fitOnMount = true,
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
    if (fitOnMount && !fittedRef.current && !bounds.isEmpty()) {
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
  }, [active, fitOnMount, interactive, map, onSelectSegment, segments]);

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
          apartment.reviewStatus === 'ready'
            ? coverageColors[apartment.coverageClass]
            : apartmentMarkerColor(apartment.reviewStatus),
        );
        content.textContent = 'A';
        const marker = new AdvancedMarkerElement({
          map,
          position: latLng(apartment.position),
          content,
          title: `${apartment.address ?? 'Apartment complex'} · ${
            apartment.reviewStatus === 'ready'
              ? apartment.lastCoveredOn
                ? `last outreach ${apartment.lastCoveredOn}`
                : 'never covered'
              : apartment.reviewStatus.replace('_', ' ')
          }`,
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
      <button
        aria-label="Edit heatmap ranges"
        className="coverage-legend-settings"
        onClick={onEditHeatmapRanges}
        type="button"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>
      {legend.map((item) => (
        <span key={item.coverageClass}>
          <i style={{ background: coverageColors[item.coverageClass] }} />
          {item.label}
        </span>
      ))}
    </fieldset>
  );
}
