'use client';

import type { Map as MapLibreMap, Marker as MapLibreMarker } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import type { MapLabData } from '@/lib/database';
import { loadGoogleMaps, type StreetlightMapType } from '@/lib/google-maps-browser';
import {
  forwardMapCameraChange,
  googleZoomToMapLibre,
  isReflectedMapCamera,
  type MapCamera,
  mapLibreZoomToGoogle,
  mapLoadErrorIsFatal,
} from '@/lib/map-camera';
import baseStyleJson from '@/lib/open-map-base-style.json';
import { buildOpenLabStyle, type OpenMapStyle } from '@/lib/open-map-style';

type WorkspaceMapProps = {
  apiKey: string;
  camera: MapCamera;
  data: MapLabData | null;
  mapType: StreetlightMapType;
  onCameraChange: (camera: MapCamera) => void;
  onMapChange: (map: MapLibreMap | null) => void;
};

export function WorkspaceMap({
  apiKey,
  camera,
  data,
  mapType,
  onCameraChange,
  onMapChange,
}: WorkspaceMapProps) {
  const openElementRef = useRef<HTMLDivElement>(null);
  const satelliteElementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<MapLibreMarker | null>(null);
  const googleMapRef = useRef<google.maps.Map | null>(null);
  const cameraRef = useRef(camera);
  const publishedCameraRef = useRef<MapCamera | null>(null);
  const mapTypeRef = useRef(mapType);
  const appliedMapTypeRef = useRef(mapType);
  const onCameraChangeRef = useRef(onCameraChange);
  const onMapChangeRef = useRef(onMapChange);
  const [mapStatus, setMapStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [googleRequested, setGoogleRequested] = useState(mapType === 'satellite');
  const [satelliteError, setSatelliteError] = useState('');

  mapTypeRef.current = mapType;
  onCameraChangeRef.current = onCameraChange;
  onMapChangeRef.current = onMapChange;

  useEffect(() => {
    if (!data || !openElementRef.current) return;
    let disposed = false;
    setMapStatus('loading');
    void import('maplibre-gl')
      .then(({ Map: MapLibre, Marker }) => {
        if (disposed || !openElementRef.current) return;
        let loaded = false;
        const map = new MapLibre({
          attributionControl: false,
          center: cameraRef.current.center,
          container: openElementRef.current,
          style: buildOpenLabStyle(
            baseStyleJson as unknown as OpenMapStyle,
            data,
            mapTypeRef.current === 'satellite' ? 'overlay' : false,
          ) as maplibregl.StyleSpecification,
          zoom: googleZoomToMapLibre(cameraRef.current.zoom),
        });
        mapRef.current = map;
        appliedMapTypeRef.current = mapTypeRef.current;
        const markerElement = document.createElement('img');
        markerElement.alt = '';
        markerElement.src = '/ChurchPin.png';
        markerElement.className = 'workspace-church-marker';
        markerRef.current = new Marker({ anchor: 'bottom', element: markerElement })
          .setLngLat(data.center)
          .addTo(map);
        map.on('load', () => {
          if (disposed) return;
          loaded = true;
          setMapStatus('ready');
          onMapChangeRef.current(map);
        });
        map.on('move', () => {
          const center = map.getCenter();
          googleMapRef.current?.moveCamera({
            center: { lat: center.lat, lng: center.lng },
            zoom: mapLibreZoomToGoogle(map.getZoom()),
          });
        });
        map.on('moveend', () => {
          const center = map.getCenter();
          const currentCamera = cameraRef.current;
          const nextCamera = forwardMapCameraChange(
            currentCamera,
            {
              center: [center.lng, center.lat] as [number, number],
              zoom: mapLibreZoomToGoogle(map.getZoom()),
            },
            (next) => {
              publishedCameraRef.current = next;
              onCameraChangeRef.current(next);
            },
          );
          if (nextCamera === currentCamera) return;
          cameraRef.current = nextCamera;
        });
        map.on('error', (event) => {
          if (!disposed && event.error && mapLoadErrorIsFatal(loaded)) setMapStatus('error');
        });
      })
      .catch(() => {
        if (!disposed) setMapStatus('error');
      });
    return () => {
      disposed = true;
      markerRef.current?.remove();
      markerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      onMapChangeRef.current(null);
    };
  }, [data]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || appliedMapTypeRef.current === mapType || !data) return;
    appliedMapTypeRef.current = mapType;
    onMapChangeRef.current(null);
    map.setStyle(
      buildOpenLabStyle(
        baseStyleJson as unknown as OpenMapStyle,
        data,
        mapType === 'satellite' ? 'overlay' : false,
      ) as maplibregl.StyleSpecification,
    );
    map.once('style.load', () => onMapChangeRef.current(map));
  }, [data, mapType]);

  useEffect(() => {
    if (isReflectedMapCamera(publishedCameraRef.current, camera)) {
      publishedCameraRef.current = null;
      return;
    }
    publishedCameraRef.current = null;
    cameraRef.current = camera;
    const map = mapRef.current;
    if (!map || mapStatus !== 'ready') return;
    map.jumpTo({ center: camera.center, zoom: googleZoomToMapLibre(camera.zoom) });
  }, [camera, mapStatus]);

  useEffect(() => {
    if (mapType === 'satellite') setGoogleRequested(true);
    const googleMap = googleMapRef.current;
    if (!googleMap) return;
    googleMap.moveCamera({
      center: { lat: cameraRef.current.center[1], lng: cameraRef.current.center[0] },
      zoom: cameraRef.current.zoom,
    });
  }, [mapType]);

  useEffect(() => {
    if (!googleRequested || !apiKey || !satelliteElementRef.current || googleMapRef.current) return;
    let disposed = false;
    setSatelliteError('');
    loadGoogleMaps(apiKey)
      .then((maps) => {
        if (disposed || !satelliteElementRef.current) return;
        googleMapRef.current = new maps.Map(satelliteElementRef.current, {
          center: {
            lat: cameraRef.current.center[1],
            lng: cameraRef.current.center[0],
          },
          zoom: cameraRef.current.zoom,
          mapId: 'DEMO_MAP_ID',
          mapTypeId: 'hybrid',
          clickableIcons: false,
          cameraControl: false,
          disableDefaultUI: true,
          gestureHandling: 'none',
          keyboardShortcuts: false,
        });
      })
      .catch(() => {
        if (!disposed) setSatelliteError('Google satellite map could not load.');
      });
    return () => {
      disposed = true;
      if (googleMapRef.current) google.maps.event.clearInstanceListeners(googleMapRef.current);
      googleMapRef.current = null;
    };
  }, [apiKey, googleRequested]);

  return (
    <div className={`workspace-map-stack ${mapType === 'satellite' ? 'satellite' : 'map'}`}>
      <div
        aria-hidden={mapType !== 'satellite'}
        className="google-map workspace-satellite-map"
        ref={satelliteElementRef}
      />
      <div
        aria-label="Streetlight outreach map"
        className="google-map workspace-open-map"
        ref={openElementRef}
        role="application"
      />
      {mapStatus === 'loading' && <span className="map-loading">Loading map…</span>}
      {mapStatus === 'error' && <span className="map-loading">Open map could not load.</span>}
      {mapType === 'satellite' && !apiKey && (
        <span className="map-loading">Satellite requires the browser map key.</span>
      )}
      {mapType === 'satellite' && satelliteError && (
        <span className="map-loading">{satelliteError}</span>
      )}
      {mapType === 'roadmap' && data && (
        <span className="workspace-map-attribution">
          {[
            data.attribution.base,
            data.attribution.roads,
            data.attribution.buildings,
            data.attribution.fema,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      )}
    </div>
  );
}
