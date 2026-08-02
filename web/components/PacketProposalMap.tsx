'use client';

import type { Map as MapLibreMap, Marker as MapLibreMarker } from 'maplibre-gl';
import { useEffect } from 'react';
import { positionBounds } from '@/lib/map-camera';
import { type PacketProposal, proposalsForMap } from '@/lib/packet-selection';
import { mapPinDataUrl } from '@/lib/territory-map-style';

type PacketProposalMapProps = {
  active: boolean;
  map: MapLibreMap | null;
  proposals: PacketProposal[];
  selectedIndex: number | null;
};

export function PacketProposalMap({
  active,
  map,
  proposals,
  selectedIndex,
}: PacketProposalMapProps) {
  useEffect(() => {
    const visibleProposals = proposalsForMap(proposals, selectedIndex);
    if (!active || !map || visibleProposals.length === 0) return;
    let disposed = false;
    const sourceId = 'streetlight-packet-proposals';
    const haloId = 'streetlight-packet-proposals-halo';
    const markers: MapLibreMarker[] = [];
    const positions = visibleProposals.flatMap((proposal) =>
      proposal.segments.flatMap(({ geometry }) => geometry.coordinates),
    );
    map.addSource(sourceId, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: visibleProposals.flatMap((proposal) =>
          proposal.segments.map((segment) => ({
            type: 'Feature' as const,
            geometry: segment.geometry,
            properties: {},
          })),
        ),
      },
    });
    const before = map.getLayer('streetlight-coverage')
      ? 'streetlight-coverage'
      : map.getLayer('highway-name-minor')
        ? 'highway-name-minor'
        : undefined;
    map.addLayer(
      {
        id: haloId,
        type: 'line',
        source: sourceId,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#78a9ff',
          'line-opacity': 1,
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 10, 14, 13],
        },
      },
      before,
    );
    const selectedProposal = selectedIndex === null ? null : visibleProposals[0];
    const markerProposals = visibleProposals.filter(
      (proposal) => proposal.kind === 'apartment' || proposal === selectedProposal,
    );
    void import('maplibre-gl').then(({ Marker }) => {
      if (disposed) return;
      for (const proposal of markerProposals) {
        const markerElement = document.createElement('img');
        markerElement.alt = '';
        markerElement.src = mapPinDataUrl('start');
        markerElement.className = 'workspace-map-pin';
        const marker = new Marker({ anchor: 'bottom', element: markerElement })
          .setLngLat(proposal.start.position)
          .addTo(map);
        marker.getElement().title =
          proposal.kind === 'apartment' ? 'Apartment complex' : 'Starting address';
        markers.push(marker);
      }
    });
    positions.push(...markerProposals.map(({ start }) => start.position));
    const bounds = positionBounds(positions);
    if (bounds) map.fitBounds(bounds, { padding: 56 });
    return () => {
      disposed = true;
      for (const marker of markers) marker.remove();
      if (map.getLayer(haloId)) map.removeLayer(haloId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    };
  }, [active, map, proposals, selectedIndex]);

  return null;
}
