import type {
  GeoJSONSource,
  MapLayerMouseEvent,
  Map as MapLibreMap,
  Marker as MapLibreMarker,
  StyleSpecification,
} from 'maplibre-gl';
import type {
  MapOverlayAdapter,
  MapOverlayEvent,
  MapOverlayMarker,
  WorkspaceMapBasePresentation,
} from './map-overlay-lifecycle.ts';
import baseStyleJson from './open-map-base-style.json' with { type: 'json' };
import { buildWorkspaceMapStyle, type OpenMapStyle } from './open-map-style.ts';
import { mapPinDataUrl } from './territory-map-style.ts';

type MarkerConstructor = typeof MapLibreMarker;

export function createMapLibreOverlayAdapter(
  map: MapLibreMap,
  Marker: MarkerConstructor,
  initialBase: WorkspaceMapBasePresentation,
): MapOverlayAdapter {
  const canvas = map.getCanvas();
  const pending = new Set<() => void>();

  function waitFor(event: 'load' | 'style.load', action?: () => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        map.off(event, loaded);
        pending.delete(cancel);
      };
      const loaded = () => {
        cleanup();
        resolve();
      };
      const cancel = () => {
        cleanup();
        reject(new Error('Open map was detached'));
      };
      pending.add(cancel);
      map.once(event, loaded);
      try {
        action?.();
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }

  return {
    initialBase,
    waitUntilReady() {
      return map.loaded() || map.isStyleLoaded() ? Promise.resolve() : waitFor('load');
    },
    replaceStyle(base) {
      return waitFor('style.load', () => {
        map.setStyle(
          buildWorkspaceMapStyle(
            baseStyleJson as unknown as OpenMapStyle,
            base.data,
            base.mapType === 'satellite',
          ) as StyleSpecification,
        );
      });
    },
    hasSource: (id) => Boolean(map.getSource(id)),
    addSource(id, data, options) {
      map.addSource(id, { type: 'geojson', data, ...options } as never);
    },
    setSourceData(id, data) {
      (map.getSource(id) as GeoJSONSource | undefined)?.setData(data as never);
    },
    removeSource(id) {
      if (map.getSource(id)) map.removeSource(id);
    },
    hasLayer: (id) => Boolean(map.getLayer(id)),
    addLayer(layer, before) {
      const { visible = true, ...definition } = layer;
      const mapLayer = {
        ...definition,
        layout: {
          ...definition.layout,
          visibility: visible ? 'visible' : 'none',
        },
      };
      map.addLayer(mapLayer as never, before && map.getLayer(before) ? before : undefined);
    },
    removeLayer(id) {
      if (map.getLayer(id)) map.removeLayer(id);
    },
    setLayerVisibility(id, visible) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    },
    setPaintProperty(id, property, value) {
      if (map.getLayer(id)) map.setPaintProperty(id, property, value as never);
    },
    styleLayers() {
      return (map.getStyle().layers ?? []).map((layer) => {
        const sourceLayer = 'source-layer' in layer ? layer['source-layer'] : undefined;
        return {
          id: layer.id,
          type: layer.type,
          source: 'source' in layer && typeof layer.source === 'string' ? layer.source : undefined,
          sourceLayer: typeof sourceLayer === 'string' ? sourceLayer : undefined,
        };
      });
    },
    onLayer(event, layerId, listener) {
      const handler = (mapEvent: MapLayerMouseEvent) =>
        listener({
          features: mapEvent.features?.map((feature) => ({
            geometry: feature.geometry as NonNullable<
              MapOverlayEvent['features']
            >[number]['geometry'],
            properties: feature.properties,
          })),
          shiftKey: mapEvent.originalEvent.shiftKey,
        });
      map.on(event, layerId, handler);
      return () => map.off(event, layerId, handler);
    },
    setCursor(cursor) {
      canvas.style.cursor = cursor;
    },
    fitBounds(bounds, options) {
      map.fitBounds(bounds, options);
    },
    easeTo(camera) {
      map.easeTo(camera);
    },
    getZoom: () => map.getZoom(),
    async getClusterExpansionZoom(sourceId, clusterId) {
      const source = map.getSource(sourceId) as GeoJSONSource | undefined;
      if (!source) throw new Error('Cluster source is unavailable');
      return source.getClusterExpansionZoom(clusterId);
    },
    registerBoxSelection({ armed, layerIds, onComplete }) {
      const container = map.getCanvasContainer();
      const boxZoomWasEnabled = map.boxZoom.isEnabled();
      map.boxZoom.disable();
      let start: { x: number; y: number } | null = null;
      let box: HTMLDivElement | null = null;
      let dragPanWasEnabled = false;
      const point = (event: MouseEvent) => {
        const bounds = container.getBoundingClientRect();
        return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      };
      const reset = () => {
        box?.remove();
        box = null;
        start = null;
        container.style.cursor = armed ? 'crosshair' : '';
        if (dragPanWasEnabled) map.dragPan.enable();
        dragPanWasEnabled = false;
      };
      const move = (event: MouseEvent) => {
        if (!start || !box) return;
        const current = point(event);
        box.style.left = `${Math.min(start.x, current.x)}px`;
        box.style.top = `${Math.min(start.y, current.y)}px`;
        box.style.width = `${Math.abs(current.x - start.x)}px`;
        box.style.height = `${Math.abs(current.y - start.y)}px`;
      };
      const finish = (event: MouseEvent) => {
        if (!start) return;
        const current = point(event);
        const dragged = Math.abs(current.x - start.x) >= 4 || Math.abs(current.y - start.y) >= 4;
        const bounds: [[number, number], [number, number]] = [
          [Math.min(start.x, current.x), Math.min(start.y, current.y)],
          [Math.max(start.x, current.x), Math.max(start.y, current.y)],
        ];
        const visibleLayers = layerIds.filter((id) => map.getLayer(id));
        const ids = [
          ...new Set(
            map
              .queryRenderedFeatures(bounds, { layers: visibleLayers })
              .filter(
                ({ properties }) => properties?.selectable && typeof properties.id === 'string',
              )
              .map(({ properties }) => properties?.id as string),
          ),
        ];
        onComplete(ids, !dragged && event.shiftKey);
        reset();
      };
      const begin = (event: MouseEvent) => {
        if (event.button !== 0 || (!event.shiftKey && !armed)) return;
        event.preventDefault();
        event.stopPropagation();
        start = point(event);
        dragPanWasEnabled = map.dragPan.isEnabled();
        map.dragPan.disable();
        box = document.createElement('div');
        box.className = 'territory-selection-box';
        container.append(box);
        container.style.cursor = 'crosshair';
      };
      if (armed) container.style.cursor = 'crosshair';
      container.addEventListener('mousedown', begin, true);
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', finish);
      return () => {
        container.removeEventListener('mousedown', begin, true);
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', finish);
        reset();
        if (boxZoomWasEnabled) map.boxZoom.enable();
      };
    },
    addMarker(marker) {
      const element = markerElement(marker);
      const instance = new Marker({
        anchor: marker.kind === 'pin' ? 'bottom' : 'center',
        element,
      })
        .setLngLat(marker.position)
        .addTo(map);
      return () => instance.remove();
    },
    dispose() {
      for (const cancel of [...pending]) cancel();
      canvas.style.cursor = '';
    },
  };
}

function markerElement(marker: MapOverlayMarker): HTMLElement {
  if (marker.kind === 'pin') {
    const element = document.createElement('img');
    element.alt = '';
    element.src = mapPinDataUrl(marker.symbol);
    element.className = 'workspace-map-pin';
    element.title = marker.title ?? '';
    return element;
  }
  const element = document.createElement('span');
  element.className = 'reconciliation-apartment-marker';
  element.style.setProperty('--reconciliation-color', marker.color);
  element.textContent = marker.text;
  element.title = marker.title;
  return element;
}
