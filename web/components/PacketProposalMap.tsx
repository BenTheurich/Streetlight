'use client';

import { useEffect } from 'react';
import { latLng } from '@/lib/google-maps-browser';
import { type PacketProposal, proposalsForMap } from '@/lib/packet-selection';
import { segmentStrokeWeight } from '@/lib/territory-map-style';

type PacketProposalMapProps = {
  active: boolean;
  map: google.maps.Map | null;
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
    let marker: google.maps.marker.AdvancedMarkerElement | null = null;
    const bounds = new google.maps.LatLngBounds();
    const lines = visibleProposals.flatMap((proposal) =>
      proposal.segments.flatMap((segment) => {
        const path = segment.geometry.coordinates.map(latLng);
        const baseWeight = Math.max(5, segmentStrokeWeight(map.getZoom() ?? 11) + 2);
        const halo = new google.maps.Polyline({
          map,
          path,
          strokeColor: '#FFFFFF',
          strokeOpacity: 0.95,
          strokeWeight: baseWeight + 4,
          clickable: false,
          zIndex: 10,
        });
        const highlight = new google.maps.Polyline({
          map,
          path,
          strokeColor: '#1769FF',
          strokeOpacity: 0.92,
          strokeWeight: baseWeight,
          clickable: false,
          zIndex: 11,
        });
        for (const point of segment.geometry.coordinates) bounds.extend(latLng(point));
        return [halo, highlight];
      }),
    );
    const selectedProposal = selectedIndex === null ? null : visibleProposals[0];
    if (selectedProposal) bounds.extend(latLng(selectedProposal.start.position));
    map.fitBounds(bounds, 56);
    const zoomListener = map.addListener('zoom_changed', () => {
      const weight = Math.max(5, segmentStrokeWeight(map.getZoom() ?? 11) + 2);
      for (let index = 0; index < lines.length; index += 2) {
        lines[index].setOptions({ strokeWeight: weight + 4 });
        lines[index + 1].setOptions({ strokeWeight: weight });
      }
    });
    if (selectedProposal) {
      void google.maps.importLibrary('marker').then((library) => {
        if (disposed) return;
        const { AdvancedMarkerElement } = library as google.maps.MarkerLibrary;
        marker = new AdvancedMarkerElement({
          map,
          position: latLng(selectedProposal.start.position),
          title: 'Starting address',
          zIndex: 30,
        });
      });
    }
    return () => {
      disposed = true;
      zoomListener.remove();
      for (const line of lines) line.setMap(null);
      if (marker) marker.map = null;
    };
  }, [active, map, proposals, selectedIndex]);

  return null;
}
