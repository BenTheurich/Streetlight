'use client';

import type {
  ExpressionSpecification,
  GeoJSONSource,
  MapLayerMouseEvent,
  Map as MapLibreMap,
} from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import { type CoverageLegendItem, coverageRoadForSegment } from '@/lib/coverage';
import type { CoverageWorkspaceApartment, CoverageWorkspaceSegment } from '@/lib/database';
import {
  type CoverageSelectionSource,
  coverageSelectionCameraOptions,
  positionBounds,
} from '@/lib/map-camera';
import type { Position } from '@/lib/territory-geometry';
import {
  apartmentLayerIds,
  apartmentMarkerColor,
  coverageColors,
  expandApartmentCluster,
  keepMapOverlayPublished,
} from '@/lib/territory-map-style';

type OpenCoverageMapProps = {
  active: boolean;
  interactive: boolean;
  map: MapLibreMap | null;
  legend: CoverageLegendItem[];
  segments: CoverageWorkspaceSegment[];
  apartmentComplexes: CoverageWorkspaceApartment[];
  selectedSegmentId: string | null;
  selectionSource: CoverageSelectionSource | null;
  showApartmentMarkers: boolean;
  onOpenMapSettings: () => void;
  onSelectSegment: (id: string) => void;
  fitOnMount?: boolean;
};

const coverageWidth: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], 11, 2, 14, 5];
const selectionWidth: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  11,
  10,
  14,
  13,
];

export function OpenCoverageMap({
  active,
  interactive,
  map,
  legend,
  segments,
  apartmentComplexes,
  selectedSegmentId,
  selectionSource,
  showApartmentMarkers,
  onOpenMapSettings,
  onSelectSegment,
  fitOnMount = true,
}: OpenCoverageMapProps) {
  const fittedRef = useRef(false);

  useEffect(() => {
    if (!map) return;
    const publish = () => {
      const visibility = active ? 'visible' : 'none';
      for (const id of [
        'streetlight-boundary',
        'streetlight-coverage-selection',
        'streetlight-coverage',
      ]) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility);
      }
      const apartmentVisibility = active && showApartmentMarkers ? 'visible' : 'none';
      for (const id of apartmentLayerIds) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', apartmentVisibility);
      }
    };
    return keepMapOverlayPublished(map, publish);
  }, [active, map, showApartmentMarkers]);

  useEffect(() => {
    if (!active || !map) return;
    const publish = () => {
      const selectedRoad = coverageRoadForSegment(segments, selectedSegmentId);
      const selectedIds = new Set(selectedRoad?.segments.map(({ id }) => id));
      (map.getSource('streetlightCoverage') as GeoJSONSource | undefined)?.setData({
        type: 'FeatureCollection',
        features: segments.map((segment) => ({
          type: 'Feature',
          geometry: segment.geometry,
          properties: {
            id: segment.id,
            selected: interactive && selectedIds.has(segment.id),
            color: segment.eligible ? coverageColors[segment.coverageClass] : coverageColors.gray,
            opacity: segment.eligible ? 0.68 : 0.42,
          },
        })),
      });
      const selectionSourceId = 'streetlightCoverageSelection';
      const selectionLayerId = 'streetlight-coverage-selection';
      if (map.getSource(selectionSourceId)) map.removeSource(selectionSourceId);
      if (!map.getLayer(selectionLayerId) && map.getSource('streetlightCoverage')) {
        map.addLayer(
          {
            id: selectionLayerId,
            type: 'line',
            source: 'streetlightCoverage',
            filter: ['==', ['get', 'selected'], true],
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': '#78a9ff',
              'line-opacity': 1,
              'line-width': selectionWidth,
            },
          },
          'streetlight-coverage',
        );
      }
      if (map.getLayer(selectionLayerId)) {
        map.setPaintProperty(selectionLayerId, 'line-opacity', 1);
        map.setPaintProperty(selectionLayerId, 'line-width', selectionWidth);
      }
      (map.getSource('streetlightApartments') as GeoJSONSource | undefined)?.setData({
        type: 'FeatureCollection',
        features: apartmentComplexes.map((apartment) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: apartment.position },
          properties: {
            id: apartment.id,
            label: 'A',
            color: apartmentMarkerColor(apartment.reviewStatus),
          },
        })),
      });
      if (map.getLayer('streetlight-coverage')) {
        map.setPaintProperty('streetlight-coverage', 'line-color', ['get', 'color']);
        map.setPaintProperty('streetlight-coverage', 'line-opacity', [
          'case',
          ['==', ['get', 'selected'], true],
          1,
          ['get', 'opacity'],
        ]);
        map.setPaintProperty('streetlight-coverage', 'line-width', coverageWidth);
      }
      if (fitOnMount && !fittedRef.current) {
        const bounds = positionBounds(segments.flatMap(({ geometry }) => geometry.coordinates));
        if (bounds) {
          map.fitBounds(bounds, { padding: 48 });
          fittedRef.current = true;
        }
      }
    };
    return keepMapOverlayPublished(map, publish);
  }, [active, apartmentComplexes, fitOnMount, interactive, map, segments, selectedSegmentId]);

  useEffect(() => {
    if (!active || !map || !selectedSegmentId || !selectionSource) return;
    const options = coverageSelectionCameraOptions(
      selectionSource,
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    );
    const selectedRoad = coverageRoadForSegment(segments, selectedSegmentId);
    const bounds = positionBounds(
      selectedRoad?.segments.flatMap(({ geometry }) => geometry.coordinates) ?? [],
    );
    if (options && bounds) map.fitBounds(bounds, options);
  }, [active, map, segments, selectedSegmentId, selectionSource]);

  useEffect(() => {
    if (!active || !map) return;
    const expand = (event: MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      const id = feature?.properties?.cluster_id;
      if (typeof id !== 'number' || feature?.geometry.type !== 'Point') return;
      const source = map.getSource('streetlightApartments') as GeoJSONSource | undefined;
      if (!source) return;
      void expandApartmentCluster(source, id, feature.geometry.coordinates as Position, (camera) =>
        map.easeTo(camera),
      );
    };
    map.on('click', 'streetlight-apartment-clusters', expand);
    return () => {
      map.off('click', 'streetlight-apartment-clusters', expand);
    };
  }, [active, map]);

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
        aria-label="Open map settings"
        className="coverage-legend-settings"
        onClick={onOpenMapSettings}
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
