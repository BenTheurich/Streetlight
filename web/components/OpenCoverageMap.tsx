'use client';

import type { GeoJSONSource, MapLayerMouseEvent, Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import type { CoverageLegendItem } from '@/lib/coverage';
import type { CoverageWorkspaceApartment, CoverageWorkspaceSegment } from '@/lib/database';
import { positionBounds } from '@/lib/map-camera';
import { apartmentMarkerColor, coverageColors } from '@/lib/territory-map-style';

type OpenCoverageMapProps = {
  active: boolean;
  interactive: boolean;
  map: MapLibreMap | null;
  legend: CoverageLegendItem[];
  segments: CoverageWorkspaceSegment[];
  apartmentComplexes: CoverageWorkspaceApartment[];
  selectedSegmentId: string | null;
  onEditHeatmapRanges: () => void;
  onSelectSegment: (id: string) => void;
  fitOnMount?: boolean;
};

const coverageWidth = ['interpolate', ['linear'], ['zoom'], 11, 2, 14, 5];

export function OpenCoverageMap({
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
}: OpenCoverageMapProps) {
  const fittedRef = useRef(false);

  useEffect(() => {
    if (!map) return;
    const visibility = active ? 'visible' : 'none';
    for (const id of [
      'streetlight-boundary',
      'streetlight-coverage',
      'streetlight-apartments',
      'streetlight-apartment-labels',
    ]) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility);
    }
  }, [active, map]);

  useEffect(() => {
    if (!active || !map) return;
    (map.getSource('streetlightCoverage') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: segments.map((segment) => ({
        type: 'Feature',
        geometry: segment.geometry,
        properties: {
          id: segment.id,
          color: segment.eligible ? coverageColors[segment.coverageClass] : coverageColors.gray,
          opacity: segment.eligible ? 0.68 : 0.42,
        },
      })),
    });
    (map.getSource('streetlightApartments') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: apartmentComplexes.map((apartment) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: apartment.position },
        properties: {
          id: apartment.id,
          label: 'A',
          color:
            apartment.reviewStatus === 'ready'
              ? coverageColors[apartment.coverageClass]
              : apartmentMarkerColor(apartment.reviewStatus),
        },
      })),
    });
    if (map.getLayer('streetlight-coverage')) {
      map.setPaintProperty('streetlight-coverage', 'line-width', [
        '+',
        coverageWidth,
        ['case', ['all', interactive, ['==', ['get', 'id'], selectedSegmentId ?? '']], 2, 0],
      ]);
    }
    if (fitOnMount && !fittedRef.current) {
      const bounds = positionBounds(segments.flatMap(({ geometry }) => geometry.coordinates));
      if (bounds) {
        map.fitBounds(bounds, { padding: 48 });
        fittedRef.current = true;
      }
    }
  }, [active, apartmentComplexes, fitOnMount, interactive, map, segments, selectedSegmentId]);

  useEffect(() => {
    if (!active || !interactive || !map) return;
    const select = (event: MapLayerMouseEvent) => {
      const id = event.features?.[0]?.properties?.id;
      if (typeof id === 'string') onSelectSegment(id);
    };
    const showPointer = () => {
      map.getCanvas().style.cursor = 'pointer';
    };
    const clearPointer = () => {
      map.getCanvas().style.cursor = '';
    };
    map.on('click', 'streetlight-coverage', select);
    map.on('mouseenter', 'streetlight-coverage', showPointer);
    map.on('mouseleave', 'streetlight-coverage', clearPointer);
    return () => {
      map.off('click', 'streetlight-coverage', select);
      map.off('mouseenter', 'streetlight-coverage', showPointer);
      map.off('mouseleave', 'streetlight-coverage', clearPointer);
      clearPointer();
    };
  }, [active, interactive, map, onSelectSegment]);

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
