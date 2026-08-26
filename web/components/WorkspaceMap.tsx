'use client';

import type { Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps, type StreetlightMapType } from '@/lib/google-maps-browser';
import {
  forwardMapCameraChange,
  googleZoomToMapLibre,
  isReflectedMapCamera,
  type MapCamera,
  mapLibreZoomToGoogle,
} from '@/lib/map-camera';
import { createMapOverlayLifecycle, type MapOverlayLifecycle } from '@/lib/map-overlay-lifecycle';
import { createMapLibreOverlayAdapter } from '@/lib/maplibre-overlay-adapter';
import baseStyleJson from '@/lib/open-map-base-style.json';
import type { OpenMapData } from '@/lib/open-map-data';
import { buildWorkspaceMapStyle, type OpenMapStyle } from '@/lib/open-map-style';

type WorkspaceMapProps = {
  apiKey: string;
  camera: MapCamera;
  data: OpenMapData | null;
  mapType: StreetlightMapType;
  onCameraChange: (camera: MapCamera) => void;
  onLifecycleChange: (lifecycle: MapOverlayLifecycle | null) => void;
};

export function WorkspaceMap({
  apiKey,
  camera,
  data,
  mapType,
  onCameraChange,
  onLifecycleChange,
}: WorkspaceMapProps) {
  const openElementRef = useRef<HTMLDivElement>(null);
  const satelliteElementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const dataRef = useRef(data);
  const googleMapRef = useRef<google.maps.Map | null>(null);
  const cameraRef = useRef(camera);
  const publishedCameraRef = useRef<MapCamera | null>(null);
  const mapTypeRef = useRef(mapType);
  const onCameraChangeRef = useRef(onCameraChange);
  const onLifecycleChangeRef = useRef(onLifecycleChange);
  const [mapStatus, setMapStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [lifecycle] = useState(() =>
    createMapOverlayLifecycle({ onStatus: ({ state }) => setMapStatus(state) }),
  );
  const [googleRequested, setGoogleRequested] = useState(mapType === 'satellite');
  const [satelliteError, setSatelliteError] = useState('');
  const mapDataAvailable = data !== null;

  dataRef.current = data;
  mapTypeRef.current = mapType;
  onCameraChangeRef.current = onCameraChange;
  onLifecycleChangeRef.current = onLifecycleChange;

  useEffect(() => {
    onLifecycleChangeRef.current(lifecycle);
    return () => {
      onLifecycleChangeRef.current(null);
    };
  }, [lifecycle]);

  useEffect(() => {
    if (!data) return;
    return lifecycle.present({ kind: 'base', data, mapType });
  }, [data, lifecycle, mapType]);

  useEffect(() => {
    if (!mapDataAvailable) return;
    const initialData = dataRef.current;
    if (!initialData || !openElementRef.current) return;
    let disposed = false;
    let detach = () => {};
    setMapStatus('loading');
    void import('maplibre-gl')
      .then(({ Map: MapLibre, Marker }) => {
        if (disposed || !openElementRef.current) return;
        const map = new MapLibre({
          attributionControl: false,
          center: cameraRef.current.center,
          container: openElementRef.current,
          style: buildWorkspaceMapStyle(
            baseStyleJson as unknown as OpenMapStyle,
            initialData,
            mapTypeRef.current === 'satellite',
          ) as maplibregl.StyleSpecification,
          zoom: googleZoomToMapLibre(cameraRef.current.zoom),
        });
        mapRef.current = map;
        detach = lifecycle.attach(
          createMapLibreOverlayAdapter(map, Marker, {
            kind: 'base',
            data: initialData,
            mapType: mapTypeRef.current,
          }),
        );
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
        if (disposed) detach();
      })
      .catch(() => {
        if (!disposed) setMapStatus('error');
      });
    return () => {
      disposed = true;
      detach();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [lifecycle, mapDataAvailable]);

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
