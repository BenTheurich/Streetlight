'use client';

import { useEffect, useRef, useState } from 'react';
import { latLng, loadGoogleMaps } from '@/lib/google-maps-browser';
import type { MapCamera } from '@/lib/map-camera';
import type { Position } from '@/lib/territory-geometry';

type AdminMapProps = {
  apiKey: string;
  churchCenter: Position;
  onMapChange: (map: google.maps.Map | null) => void;
  camera?: MapCamera;
  mapTypeControl?: boolean;
  onCameraChange?: (camera: MapCamera) => void;
  onStatusChange?: (status: 'loading' | 'ready' | 'error') => void;
};

export function AdminMap({
  apiKey,
  churchCenter,
  onMapChange,
  camera,
  mapTypeControl = false,
  onCameraChange,
  onStatusChange,
}: AdminMapProps) {
  const elementRef = useRef<HTMLDivElement>(null);
  const onMapChangeRef = useRef(onMapChange);
  const onCameraChangeRef = useRef(onCameraChange);
  const onStatusChangeRef = useRef(onStatusChange);
  const centerRef = useRef(churchCenter);
  const cameraRef = useRef(camera);
  const mapRef = useRef<google.maps.Map | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(apiKey ? 'loading' : 'error');

  onMapChangeRef.current = onMapChange;
  onCameraChangeRef.current = onCameraChange;
  onStatusChangeRef.current = onStatusChange;
  centerRef.current = churchCenter;
  cameraRef.current = camera;

  useEffect(() => {
    if (!apiKey || !elementRef.current) return;
    let disposed = false;
    loadGoogleMaps(apiKey)
      .then((maps) => {
        if (disposed || !elementRef.current) return;
        const map = new maps.Map(elementRef.current, {
          center: latLng(cameraRef.current?.center ?? centerRef.current),
          zoom: cameraRef.current?.zoom ?? 11,
          mapId: 'DEMO_MAP_ID',
          mapTypeControl,
          cameraControl: false,
          rotateControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          clickableIcons: false,
        });
        mapRef.current = map;
        map.addListener('idle', () => {
          const center = map.getCenter();
          const zoom = map.getZoom();
          if (center && zoom !== undefined) {
            onCameraChangeRef.current?.({
              center: [center.lng(), center.lat()],
              zoom,
            });
          }
        });
        onMapChangeRef.current(map);
        setStatus('ready');
        onStatusChangeRef.current?.('ready');
      })
      .catch(() => {
        if (!disposed) {
          setStatus('error');
          onStatusChangeRef.current?.('error');
        }
      });
    return () => {
      disposed = true;
      if (mapRef.current) google.maps.event.clearInstanceListeners(mapRef.current);
      mapRef.current = null;
      onMapChangeRef.current(null);
    };
  }, [apiKey, mapTypeControl]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready' || !camera) return;
    map.moveCamera({ center: latLng(camera.center), zoom: camera.zoom });
  }, [camera, status]);

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
        anchorLeft: '-50%',
        anchorTop: '-84.4%',
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
