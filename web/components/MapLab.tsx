'use client';

import type { Map as MapLibreMap } from 'maplibre-gl';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CoverageWorkspace, MapLabBuildingCounts, MapLabData } from '@/lib/database';
import { type MapCamera, mergeMapCamera } from '@/lib/map-camera';
import baseStyleJson from '@/lib/open-map-base-style.json';
import { buildOpenLabStyle, type OpenMapStyle } from '@/lib/open-map-style';
import { AdminMap } from './AdminMap';
import { CoverageMap } from './CoverageMap';
import { MapLayersControl } from './MapLayersControl';

type Mode = 'open' | 'google' | 'compare';
type PaneDiagnostics = {
  readyMs: number | null;
  bytes: number;
  streets: number;
  apartments: number;
  overture: number;
  fema: number;
  error: string;
};

const emptyDiagnostics: PaneDiagnostics = {
  readyMs: null,
  bytes: 0,
  streets: 0,
  apartments: 0,
  overture: 0,
  fema: 0,
  error: '',
};

function Diagnostics({
  camera,
  diagnostics,
  doubleMap,
  onRetry,
}: {
  camera: MapCamera;
  diagnostics: PaneDiagnostics;
  doubleMap: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="map-lab-diagnostics">
      <span>{doubleMap ? 'Double-map load' : 'Single-map load'}</span>
      <span>Ready: {diagnostics.readyMs === null ? '—' : `${diagnostics.readyMs} ms`}</span>
      <span>Data: {(diagnostics.bytes / 1024).toFixed(1)} KB</span>
      <span>
        {diagnostics.streets} streets · {diagnostics.apartments} apartments
      </span>
      <span>
        {diagnostics.overture} Overture · {diagnostics.fema} FEMA
      </span>
      <span>
        {camera.center[1].toFixed(5)}, {camera.center[0].toFixed(5)} · z{camera.zoom.toFixed(2)}
      </span>
      {diagnostics.error && (
        <span className="map-lab-error" role="alert">
          {diagnostics.error}{' '}
          <button onClick={onRetry} type="button">
            Retry
          </button>
        </span>
      )}
    </div>
  );
}

function GooglePane({
  apiKey,
  camera,
  data,
  doubleMap,
  onCameraChange,
  retry,
  buildingCounts,
}: {
  apiKey: string;
  camera: MapCamera;
  data: CoverageWorkspace;
  doubleMap: boolean;
  onCameraChange: (camera: MapCamera) => void;
  retry: () => void;
  buildingCounts: MapLabBuildingCounts;
}) {
  const started = useRef(performance.now());
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [diagnostics, setDiagnostics] = useState<PaneDiagnostics>(() => ({
    ...emptyDiagnostics,
    bytes: new TextEncoder().encode(JSON.stringify(data)).length,
    streets: data.segments.length,
    apartments: data.apartmentComplexes.length,
    overture: buildingCounts.overture,
    fema: buildingCounts.fema,
  }));

  const mapChanged = useCallback((value: google.maps.Map | null) => {
    setMap(value);
    if (value) {
      setDiagnostics((current) => ({
        ...current,
        readyMs: Math.round(performance.now() - started.current),
      }));
    }
  }, []);

  return (
    <section className="map-lab-pane">
      <div className="map-lab-canvas">
        <AdminMap
          apiKey={apiKey}
          camera={camera}
          churchCenter={data.center}
          mapTypeControl
          onCameraChange={onCameraChange}
          onMapChange={mapChanged}
          onStatusChange={(status) => {
            if (status === 'error') {
              setDiagnostics((current) => ({ ...current, error: 'Google map could not load' }));
            }
          }}
        />
        <MapLayersControl map={map} />
        <CoverageMap
          active
          apartmentComplexes={data.apartmentComplexes}
          fitOnMount={false}
          interactive={false}
          legend={data.legend}
          map={map}
          onSelectSegment={() => {}}
          segments={data.segments}
          selectedSegmentId={null}
        />
      </div>
      <Diagnostics
        camera={camera}
        diagnostics={diagnostics}
        doubleMap={doubleMap}
        onRetry={retry}
      />
    </section>
  );
}

function OpenPane({
  camera,
  doubleMap,
  onCameraChange,
  retry,
}: {
  camera: MapCamera;
  doubleMap: boolean;
  onCameraChange: (camera: MapCamera) => void;
  retry: () => void;
}) {
  const elementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const cameraRef = useRef(camera);
  const satelliteRef = useRef(false);
  const started = useRef(performance.now());
  const [data, setData] = useState<MapLabData | null>(null);
  const [satellite, setSatellite] = useState(false);
  const [satelliteCopyright, setSatelliteCopyright] = useState('');
  const [diagnostics, setDiagnostics] = useState<PaneDiagnostics>(emptyDiagnostics);
  cameraRef.current = camera;
  satelliteRef.current = satellite;

  const updateSatelliteAttribution = useCallback(async (map: MapLibreMap) => {
    const bounds = map.getBounds();
    if (!bounds || !map.getLayer('satellite')) return;
    map.setLayoutProperty('satellite', 'visibility', 'none');
    const search = new URLSearchParams({
      zoom: String(Math.round(map.getZoom())),
      north: String(bounds.getNorth()),
      south: String(bounds.getSouth()),
      east: String(bounds.getEast()),
      west: String(bounds.getWest()),
    });
    try {
      const response = await fetch(`/api/founder/map-lab/satellite-attribution?${search}`);
      const result = (await response.json()) as { copyright?: string; error?: string };
      if (!response.ok || !result.copyright) {
        throw new Error(result.error ?? 'Could not load satellite attribution');
      }
      setSatelliteCopyright(result.copyright);
      map.setLayoutProperty('satellite', 'visibility', 'visible');
      setDiagnostics((current) => ({ ...current, error: '' }));
    } catch (error) {
      setDiagnostics((current) => ({
        ...current,
        error: error instanceof Error ? error.message : 'Could not load satellite attribution',
      }));
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/founder/map-lab', { signal: controller.signal })
      .then(async (response) => {
        const text = await response.text();
        const value = JSON.parse(text) as MapLabData | { error: string };
        if (!response.ok || 'error' in value) {
          throw new Error('error' in value ? value.error : 'Could not load open-map data');
        }
        setData(value);
        setDiagnostics((current) => ({
          ...current,
          bytes: new TextEncoder().encode(text).length,
          streets: value.segments.length,
          apartments: value.apartmentComplexes.length,
          overture: value.buildings.filter(({ source }) => source === 'overture').length,
          fema: value.buildings.filter(({ source }) => source === 'fema').length,
        }));
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setDiagnostics((current) => ({
          ...current,
          error: error instanceof Error ? error.message : 'Could not load open-map data',
        }));
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!data || !elementRef.current) return;
    let disposed = false;
    void import('maplibre-gl').then(({ Map: MapLibre }) => {
      if (disposed || !elementRef.current) return;
      const map = new MapLibre({
        container: elementRef.current,
        style: buildOpenLabStyle(
          baseStyleJson as unknown as OpenMapStyle,
          data,
          false,
        ) as maplibregl.StyleSpecification,
        center: cameraRef.current.center,
        zoom: cameraRef.current.zoom,
        attributionControl: false,
      });
      mapRef.current = map;
      map.on('load', () => {
        setDiagnostics((current) => ({
          ...current,
          readyMs: Math.round(performance.now() - started.current),
          error: '',
        }));
      });
      map.on('style.load', () => {
        setDiagnostics((current) => ({ ...current, error: '' }));
        if (satelliteRef.current) void updateSatelliteAttribution(map);
      });
      map.on('moveend', () => {
        const center = map.getCenter();
        onCameraChange({ center: [center.lng, center.lat], zoom: map.getZoom() });
        if (satelliteRef.current) void updateSatelliteAttribution(map);
      });
      map.on('error', (event) => {
        setDiagnostics((current) => ({
          ...current,
          error: event.error?.message ?? 'Open map could not load',
        }));
      });
    });
    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [data, onCameraChange, updateSatelliteAttribution]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.jumpTo({ center: camera.center, zoom: camera.zoom });
  }, [camera]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data) return;
    setSatelliteCopyright('');
    map.setStyle(
      buildOpenLabStyle(
        baseStyleJson as unknown as OpenMapStyle,
        data,
        satellite,
      ) as maplibregl.StyleSpecification,
    );
  }, [data, satellite]);

  return (
    <section className="map-lab-pane">
      <div className="map-lab-canvas">
        {!data && !diagnostics.error && <span className="map-loading">Loading open map…</span>}
        <div
          aria-label="Streetlight open map"
          className="open-map"
          ref={elementRef}
          role="application"
        />
        <div className="map-lab-basemap-control">
          <button aria-pressed={!satellite} onClick={() => setSatellite(false)} type="button">
            Map
          </button>
          <button aria-pressed={satellite} onClick={() => setSatellite(true)} type="button">
            Satellite
          </button>
        </div>
        {data && (
          <span className="map-lab-attribution">
            {satellite
              ? `Google Maps${satelliteCopyright ? ` · ${satelliteCopyright}` : ''}`
              : [
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
      <Diagnostics
        camera={camera}
        diagnostics={diagnostics}
        doubleMap={doubleMap}
        onRetry={retry}
      />
    </section>
  );
}

export function MapLab({
  buildingCounts,
  initialData,
  mapsApiKey,
}: {
  initialData: CoverageWorkspace;
  buildingCounts: MapLabBuildingCounts;
  mapsApiKey: string;
}) {
  const [mode, setMode] = useState<Mode>('open');
  const [camera, setCamera] = useState<MapCamera>({
    center: initialData.center,
    zoom: 13,
  });
  const [openKey, setOpenKey] = useState(0);
  const [googleKey, setGoogleKey] = useState(0);
  const changeCamera = useCallback((next: MapCamera) => {
    setCamera((current) => mergeMapCamera(current, next));
  }, []);

  return (
    <main className="map-lab">
      <header className="map-lab-header">
        <div>
          <span className="phase-label">Founder experiment</span>
          <h1>Map Lab</h1>
          <p>Read-only comparison of the current church territory.</p>
        </div>
        <fieldset className="map-lab-mode">
          <legend className="sr-only">Map viewing mode</legend>
          {(
            [
              ['open', 'Open map'],
              ['google', 'Google map'],
              ['compare', 'Compare'],
            ] as const
          ).map(([value, label]) => (
            <button
              aria-pressed={mode === value}
              key={value}
              onClick={() => setMode(value)}
              type="button"
            >
              {label}
            </button>
          ))}
        </fieldset>
      </header>
      <div className={`map-lab-grid ${mode === 'compare' ? 'compare' : ''}`}>
        {(mode === 'open' || mode === 'compare') && (
          <OpenPane
            camera={camera}
            doubleMap={mode === 'compare'}
            key={openKey}
            onCameraChange={changeCamera}
            retry={() => setOpenKey((value) => value + 1)}
          />
        )}
        {(mode === 'google' || mode === 'compare') && (
          <GooglePane
            apiKey={mapsApiKey}
            buildingCounts={buildingCounts}
            camera={camera}
            data={initialData}
            doubleMap={mode === 'compare'}
            key={googleKey}
            onCameraChange={changeCamera}
            retry={() => setGoogleKey((value) => value + 1)}
          />
        )}
      </div>
    </main>
  );
}
