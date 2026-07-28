'use client';

import { useEffect, useRef, useState } from 'react';
import { latLng, loadGoogleMaps } from '@/lib/google-maps-browser';
import type { Position } from '@/lib/territory-geometry';

type AdminMapProps = {
  apiKey: string;
  churchCenter: Position;
  onMapChange: (map: google.maps.Map | null) => void;
};

export function AdminMap({ apiKey, churchCenter, onMapChange }: AdminMapProps) {
  const elementRef = useRef<HTMLDivElement>(null);
  const onMapChangeRef = useRef(onMapChange);
  const centerRef = useRef(churchCenter);
  const mapRef = useRef<google.maps.Map | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(apiKey ? 'loading' : 'error');

  onMapChangeRef.current = onMapChange;
  centerRef.current = churchCenter;

  useEffect(() => {
    if (!apiKey || !elementRef.current) return;
    let disposed = false;
    loadGoogleMaps(apiKey)
      .then((maps) => {
        if (disposed || !elementRef.current) return;
        const map = new maps.Map(elementRef.current, {
          center: latLng(centerRef.current),
          zoom: 11,
          mapId: 'DEMO_MAP_ID',
          mapTypeControl: true,
          mapTypeControlOptions: {
            mapTypeIds: [maps.MapTypeId.ROADMAP, maps.MapTypeId.SATELLITE],
            position: maps.ControlPosition.TOP_LEFT,
          },
          streetViewControl: false,
          fullscreenControl: false,
          clickableIcons: false,
        });
        mapRef.current = map;
        onMapChangeRef.current(map);
        setStatus('ready');
      })
      .catch(() => {
        if (!disposed) setStatus('error');
      });
    return () => {
      disposed = true;
      if (mapRef.current) google.maps.event.clearInstanceListeners(mapRef.current);
      mapRef.current = null;
      onMapChangeRef.current(null);
    };
  }, [apiKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready') return;
    let disposed = false;
    let marker: google.maps.marker.AdvancedMarkerElement | null = null;
    void google.maps.importLibrary('marker').then((library) => {
      if (disposed) return;
      const image = document.createElement('img');
      image.alt = '';
      image.src = '/ChurchPin.png';
      image.style.width = '44px';
      image.style.height = '44px';
      image.style.objectFit = 'contain';
      const { AdvancedMarkerElement } = library as google.maps.MarkerLibrary;
      marker = new AdvancedMarkerElement({
        content: image,
        map,
        position: latLng(churchCenter),
        title: 'Church',
      });
    });
    return () => {
      disposed = true;
      if (marker) marker.map = null;
    };
  }, [churchCenter, status]);

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
        aria-label="Streetlight outreach map"
        className="google-map"
        ref={elementRef}
        role="application"
      />
      {status === 'loading' && <span className="map-loading">Loading map…</span>}
      {status === 'error' && <span className="map-loading">Google map could not load.</span>}
    </>
  );
}
