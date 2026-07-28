'use client';

import { useEffect, useRef, useState } from 'react';
import { latLng, loadGoogleMaps } from '@/lib/google-maps-browser';
import type { PacketProposal } from '@/lib/packet-selection';
import type { Position } from '@/lib/territory-geometry';
import { segmentStrokeWeight } from '@/lib/territory-map-style';

type PacketProposalMapProps = {
  apiKey: string;
  center: Position;
  proposal: PacketProposal | null;
};

export function PacketProposalMap({ apiKey, center, proposal }: PacketProposalMapProps) {
  const elementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(apiKey ? 'loading' : 'error');

  useEffect(() => {
    if (!apiKey || !elementRef.current) return;
    let disposed = false;
    loadGoogleMaps(apiKey)
      .then((maps) => {
        if (disposed || !elementRef.current) return;
        mapRef.current = new maps.Map(elementRef.current, {
          center: latLng(center),
          zoom: 11,
          mapId: 'DEMO_MAP_ID',
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          clickableIcons: false,
        });
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
  }, [apiKey, center]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready' || !proposal) return;
    let disposed = false;
    let marker: google.maps.marker.AdvancedMarkerElement | null = null;
    const bounds = new google.maps.LatLngBounds();
    const lines = proposal.segments.map((segment) => {
      const line = new google.maps.Polyline({
        map,
        path: segment.geometry.coordinates.map(latLng),
        strokeColor: '#D66B2D',
        strokeOpacity: 0.72,
        strokeWeight: segmentStrokeWeight(map.getZoom() ?? 11),
        clickable: false,
      });
      for (const point of segment.geometry.coordinates) bounds.extend(latLng(point));
      return line;
    });
    bounds.extend(latLng(proposal.start.position));
    map.fitBounds(bounds, 48);
    const zoomListener = map.addListener('zoom_changed', () => {
      const weight = segmentStrokeWeight(map.getZoom() ?? 11);
      for (const line of lines) line.setOptions({ strokeWeight: weight });
    });
    void google.maps.importLibrary('marker').then((library) => {
      if (disposed) return;
      const { AdvancedMarkerElement } = library as google.maps.MarkerLibrary;
      marker = new AdvancedMarkerElement({
        map,
        position: latLng(proposal.start.position),
        title: 'Starting address',
      });
    });
    return () => {
      disposed = true;
      zoomListener.remove();
      for (const line of lines) line.setMap(null);
      if (marker) marker.map = null;
    };
  }, [proposal, status]);

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
        aria-label="Selected packet proposal"
        className="google-map"
        ref={elementRef}
        role="application"
      />
      {status === 'loading' && <span className="map-loading">Loading map…</span>}
      {status === 'error' && <span className="map-loading">Google map could not load.</span>}
    </>
  );
}
