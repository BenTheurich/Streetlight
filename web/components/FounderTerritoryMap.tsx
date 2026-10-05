'use client';

import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import type { FounderChurchAccount } from '@/lib/founder-account-types';
import baseStyle from '@/lib/open-map-base-style.json' with { type: 'json' };
import { buildBaseMapStyle, type OpenMapStyle } from '@/lib/open-map-style';
import { mapPinDataUrl, territoryBoundaryStyle } from '@/lib/territory-map-style';

export function FounderTerritoryMap({
  territory,
  churchName,
}: {
  territory: NonNullable<FounderChurchAccount['territory']>;
  churchName: string;
}) {
  const container = useRef<HTMLElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let disposed = false;
    let map: MapLibreMap | undefined;
    setState('loading');
    void import('maplibre-gl')
      .then(({ Map: MapLibre, Marker, NavigationControl }) => {
        if (disposed || !container.current) return;
        map = new MapLibre({
          container: container.current,
          center: territory.center,
          zoom: 12,
          style: buildBaseMapStyle(baseStyle as unknown as OpenMapStyle) as StyleSpecification,
        });
        map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
        map.on('error', () => {
          if (!disposed) setState('error');
        });
        map.on('load', () => {
          if (!map || disposed) return;
          map.addSource('founder-boundary', {
            type: 'geojson',
            data: { type: 'Feature', properties: {}, geometry: territory.boundary },
          });
          map.addLayer({
            id: 'founder-boundary-fill',
            type: 'fill',
            source: 'founder-boundary',
            paint: { 'fill-color': territoryBoundaryStyle.fill, 'fill-opacity': 0.12 },
          });
          map.addLayer({
            id: 'founder-boundary-line',
            type: 'line',
            source: 'founder-boundary',
            paint: {
              'line-color': territoryBoundaryStyle.color,
              'line-width': territoryBoundaryStyle.width,
              'line-dasharray': [...territoryBoundaryStyle.dashArray],
            },
          });
          const marker = document.createElement('img');
          marker.src = mapPinDataUrl('church');
          marker.alt = churchName;
          marker.width = 44;
          marker.height = 44;
          new Marker({ element: marker, anchor: 'bottom' }).setLngLat(territory.center).addTo(map);
          const points = territory.boundary.coordinates.flat();
          map.fitBounds(
            [
              [Math.min(...points.map(([x]) => x)), Math.min(...points.map(([, y]) => y))],
              [Math.max(...points.map(([x]) => x)), Math.max(...points.map(([, y]) => y))],
            ],
            { padding: 32, duration: 0 },
          );
          setState('ready');
        });
      })
      .catch(() => {
        if (!disposed) setState('error');
      });
    return () => {
      disposed = true;
      map?.remove();
    };
  }, [territory, churchName]);

  return (
    <div className="founder-territory-map-wrap">
      <section
        className="founder-territory-map"
        ref={container}
        aria-label={`Saved outreach territory for ${churchName}`}
      />
      {state !== 'ready' && (
        <p className="founder-map-status" role="status">
          {state === 'loading'
            ? 'Loading territory map…'
            : 'The map could not fully load. Saved territory details are shown below.'}
        </p>
      )}
    </div>
  );
}
