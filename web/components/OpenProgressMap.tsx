'use client';

import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import { useEffect } from 'react';
import type { CoverageWorkspace } from '@/lib/database';
import type { OutreachProgressPeriod } from '@/lib/outreach-progress';

const layerIds = [
  'streetlight-progress-context',
  'streetlight-progress-glow',
  'streetlight-progress-lines',
  'streetlight-progress-apartment-context',
  'streetlight-progress-apartments',
] as const;

export function OpenProgressMap({
  active,
  map,
  progress,
  through,
  workspace,
}: {
  active: boolean;
  map: MapLibreMap | null;
  progress: OutreachProgressPeriod;
  through: string | null;
  workspace: CoverageWorkspace;
}) {
  useEffect(() => {
    if (!map) return;
    const visibility = active ? 'visible' : 'none';
    for (const id of layerIds) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility);
    }
  }, [active, map]);

  useEffect(() => {
    if (!active || !map) return;
    const completionById = new Map(progress.units.map((unit) => [unit.id, unit.completedOn]));
    const data = {
      type: 'FeatureCollection' as const,
      features: [
        ...workspace.segments.map((segment) => {
          const completedOn = completionById.get(segment.id) ?? null;
          return {
            type: 'Feature' as const,
            geometry: segment.geometry,
            properties: { completed: Boolean(through && completedOn && completedOn <= through) },
          };
        }),
        ...workspace.apartmentComplexes.map((apartment) => {
          const completedOn = completionById.get(apartment.id) ?? null;
          return {
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: apartment.position },
            properties: { completed: Boolean(through && completedOn && completedOn <= through) },
          };
        }),
      ],
    };
    const source = map.getSource('streetlightProgress') as GeoJSONSource | undefined;
    if (source) source.setData(data);
    else map.addSource('streetlightProgress', { type: 'geojson', data });
    const before = map.getLayer('highway-name-minor') ? 'highway-name-minor' : undefined;
    if (!map.getLayer('streetlight-progress-context')) {
      map.addLayer(
        {
          id: 'streetlight-progress-context',
          type: 'line',
          source: 'streetlightProgress',
          filter: ['==', ['geometry-type'], 'LineString'],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': '#8f9b94',
            'line-opacity': 0.32,
            'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.5, 14, 3.5],
          },
        },
        before,
      );
      map.addLayer(
        {
          id: 'streetlight-progress-glow',
          type: 'line',
          source: 'streetlightProgress',
          filter: [
            'all',
            ['==', ['geometry-type'], 'LineString'],
            ['==', ['get', 'completed'], true],
          ],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': '#fff0b8',
            'line-opacity': 0.72,
            'line-width': ['interpolate', ['linear'], ['zoom'], 11, 7, 14, 11],
          },
        },
        before,
      );
      map.addLayer(
        {
          id: 'streetlight-progress-lines',
          type: 'line',
          source: 'streetlightProgress',
          filter: [
            'all',
            ['==', ['geometry-type'], 'LineString'],
            ['==', ['get', 'completed'], true],
          ],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': '#d79b2b',
            'line-opacity': 0.98,
            'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 5],
          },
        },
        before,
      );
      map.addLayer(
        {
          id: 'streetlight-progress-apartment-context',
          type: 'circle',
          source: 'streetlightProgress',
          filter: ['==', ['geometry-type'], 'Point'],
          paint: {
            'circle-color': '#8f9b94',
            'circle-opacity': 0.48,
            'circle-radius': 4,
            'circle-stroke-color': '#fffdf7',
            'circle-stroke-width': 1,
          },
        },
        before,
      );
      map.addLayer(
        {
          id: 'streetlight-progress-apartments',
          type: 'circle',
          source: 'streetlightProgress',
          filter: ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'completed'], true]],
          paint: {
            'circle-color': '#d79b2b',
            'circle-radius': 7,
            'circle-stroke-color': '#fff0b8',
            'circle-stroke-width': 3,
          },
        },
        before,
      );
    }
  }, [active, map, progress, through, workspace]);

  if (!active) return null;
  return (
    <fieldset className="map-legend progress-map-legend">
      <legend className="sr-only">Outreach progress legend</legend>
      <span>
        <i className="progress-complete" /> Reached this period
      </span>
      <span>
        <i className="progress-context" /> Region context
      </span>
    </fieldset>
  );
}
