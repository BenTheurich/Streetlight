import type {
  GeoJSONSource,
  MapLayerMouseEvent,
  Map as MapLibreMap,
  Marker as MapLibreMarker,
  MapMouseEvent,
  StyleSpecification,
} from 'maplibre-gl';
import type {
  MapOverlayAdapter,
  MapOverlayEvent,
  MapOverlayMarker,
  ProgressMapMask,
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
  const canvasContainer = map.getCanvasContainer();
  let overlayCursor: '' | 'crosshair' | 'pointer' = '';
  let selectionCursorActive = false;
  let ignoreNextMapClick = false;
  let progressMask: ProgressMapMask = { visible: false, lines: [] };
  let progressMaskCanvas: HTMLCanvasElement | null = null;
  let progressMaskContext: CanvasRenderingContext2D | null = null;
  let progressMaskCutoutCanvas: HTMLCanvasElement | null = null;
  let progressMaskCutoutContext: CanvasRenderingContext2D | null = null;

  const drawProgressMask = () => {
    if (
      !progressMask.visible ||
      !progressMaskCanvas ||
      !progressMaskContext ||
      !progressMaskCutoutCanvas ||
      !progressMaskCutoutContext
    )
      return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;
    const pixelRatio = window.devicePixelRatio || 1;
    const targetWidth = Math.round(width * pixelRatio);
    const targetHeight = Math.round(height * pixelRatio);
    if (progressMaskCanvas.width !== targetWidth) progressMaskCanvas.width = targetWidth;
    if (progressMaskCanvas.height !== targetHeight) progressMaskCanvas.height = targetHeight;
    if (progressMaskCutoutCanvas.width !== targetWidth)
      progressMaskCutoutCanvas.width = targetWidth;
    if (progressMaskCutoutCanvas.height !== targetHeight)
      progressMaskCutoutCanvas.height = targetHeight;
    const context = progressMaskContext;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.globalCompositeOperation = 'source-over';
    context.globalAlpha = 1;
    context.clearRect(0, 0, width, height);
    context.fillStyle = 'rgb(7 17 31 / 46%)';
    context.fillRect(0, 0, width, height);
    if (progressMask.lines.length === 0 && !progressMask.active) return;

    const zoomProgress = Math.max(0, Math.min(1, (map.getZoom() - 11) / 3));
    const roadWidth = 20 + zoomProgress * 18;
    const cutout = progressMaskCutoutContext;
    cutout.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    cutout.globalCompositeOperation = 'source-over';
    cutout.globalAlpha = 1;
    cutout.clearRect(0, 0, width, height);
    cutout.strokeStyle = '#000';
    cutout.lineCap = 'round';
    cutout.lineJoin = 'round';
    cutout.lineWidth = roadWidth;
    const addRoads = (lines: ProgressMapMask['lines'], opacity: number) => {
      if (lines.length === 0 || opacity <= 0) return;
      cutout.globalAlpha = opacity;
      cutout.beginPath();
      for (const coordinates of lines) {
        if (coordinates.length < 2) continue;
        const start = map.project(coordinates[0]);
        cutout.moveTo(start.x, start.y);
        for (const coordinate of coordinates.slice(1)) {
          const point = map.project(coordinate);
          cutout.lineTo(point.x, point.y);
        }
      }
      cutout.stroke();
    };
    addRoads(progressMask.lines, 1);
    if (progressMask.active) addRoads(progressMask.active.lines, progressMask.active.opacity);

    context.globalCompositeOperation = 'destination-out';
    context.globalAlpha = 1;
    context.filter = 'blur(12px)';
    context.drawImage(progressMaskCutoutCanvas, 0, 0, width, height);
    context.filter = 'none';
  };

  const ensureProgressMask = () => {
    if (progressMaskCanvas) return;
    const maskCanvas = document.createElement('canvas');
    const context = maskCanvas.getContext('2d');
    const cutoutCanvas = document.createElement('canvas');
    const cutoutContext = cutoutCanvas.getContext('2d');
    if (!context || !cutoutContext) return;
    maskCanvas.ariaHidden = 'true';
    maskCanvas.className = 'progress-map-mask';
    canvasContainer.append(maskCanvas);
    progressMaskCanvas = maskCanvas;
    progressMaskContext = context;
    progressMaskCutoutCanvas = cutoutCanvas;
    progressMaskCutoutContext = cutoutContext;
    map.on('move', drawProgressMask);
    map.on('resize', drawProgressMask);
  };

  const syncCursor = () => {
    canvas.style.cursor = selectionCursorActive ? 'crosshair' : overlayCursor;
  };

  const setSelectionCursor = (active: boolean, clearOverlay = false) => {
    selectionCursorActive = active;
    if (clearOverlay) overlayCursor = '';
    syncCursor();
  };

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
    waitUntilSettled(signal) {
      return new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          map.off('idle', rendered);
          map.off('error', failed);
          signal.removeEventListener('abort', cancel);
          pending.delete(detached);
        };
        const rendered = () => {
          cleanup();
          resolve();
        };
        const failed = () => {
          cleanup();
          reject(new Error('Open map could not finish rendering.'));
        };
        const cancel = () => {
          cleanup();
          reject(signal.reason);
        };
        const detached = () => {
          cleanup();
          reject(new Error('Open map was detached'));
        };
        pending.add(detached);
        map.once('idle', rendered);
        map.on('error', failed);
        signal.addEventListener('abort', cancel, { once: true });
        if (signal.aborted) cancel();
        else map.triggerRepaint();
      });
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
    setProgressMask(mask) {
      progressMask = mask;
      if (!mask.visible) {
        if (progressMaskCanvas) progressMaskCanvas.hidden = true;
        return;
      }
      ensureProgressMask();
      if (!progressMaskCanvas) return;
      progressMaskCanvas.hidden = false;
      drawProgressMask();
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
      overlayCursor = cursor;
      syncCursor();
    },
    resize() {
      map.resize();
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
    registerBoxSelection({ armed, layerIds, onComplete, onEmptyClick }) {
      const container = map.getCanvasContainer();
      const boxZoomWasEnabled = map.boxZoom.isEnabled();
      map.boxZoom.disable();
      let start: { x: number; y: number } | null = null;
      let box: HTMLDivElement | null = null;
      let dragPanWasEnabled = false;
      let shiftPressed = false;
      let dragging = false;
      let armedActive = armed;
      const point = (event: MouseEvent) => {
        const bounds = container.getBoundingClientRect();
        return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      };
      const selectedIds = (bounds: Parameters<MapLibreMap['queryRenderedFeatures']>[0]) => {
        const visibleLayers = layerIds.filter((id) => map.getLayer(id));
        if (visibleLayers.length === 0) return [];
        return [
          ...new Set(
            map
              .queryRenderedFeatures(bounds, { layers: visibleLayers })
              .filter(
                ({ properties }) => properties?.selectable && typeof properties.id === 'string',
              )
              .map(({ properties }) => properties?.id as string),
          ),
        ];
      };
      const clearBox = () => {
        box?.remove();
        box = null;
        start = null;
        if (dragPanWasEnabled) map.dragPan.enable();
        dragPanWasEnabled = false;
        dragging = false;
      };
      const syncSelectionCursor = (clearOverlay = false) => {
        setSelectionCursor(armedActive || shiftPressed || dragging, clearOverlay);
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
        const ids = selectedIds(dragged ? bounds : [current.x, current.y]);
        clearBox();
        armedActive = false;
        shiftPressed = false;
        ignoreNextMapClick = true;
        syncSelectionCursor(true);
        onComplete(ids, !dragged && event.shiftKey);
      };
      const begin = (event: MouseEvent) => {
        ignoreNextMapClick = false;
        if (event.button !== 0 || (!event.shiftKey && !armedActive)) return;
        event.preventDefault();
        event.stopPropagation();
        start = point(event);
        dragging = true;
        dragPanWasEnabled = map.dragPan.isEnabled();
        map.dragPan.disable();
        box = document.createElement('div');
        box.className = 'territory-selection-box';
        container.append(box);
        syncSelectionCursor();
      };
      const keyDown = (event: KeyboardEvent) => {
        if (event.key !== 'Shift') return;
        shiftPressed = true;
        syncSelectionCursor();
      };
      const keyUp = (event: KeyboardEvent) => {
        if (event.key !== 'Shift') return;
        shiftPressed = false;
        syncSelectionCursor(!armedActive && !dragging);
      };
      const click = (event: MapMouseEvent) => {
        if (ignoreNextMapClick) {
          ignoreNextMapClick = false;
          return;
        }
        if (armed || event.originalEvent.shiftKey) return;
        if (selectedIds(event.point).length === 0) onEmptyClick();
      };
      syncSelectionCursor();
      container.addEventListener('mousedown', begin, true);
      window.addEventListener('keydown', keyDown);
      window.addEventListener('keyup', keyUp);
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', finish);
      map.on('click', click);
      return () => {
        container.removeEventListener('mousedown', begin, true);
        window.removeEventListener('keydown', keyDown);
        window.removeEventListener('keyup', keyUp);
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', finish);
        map.off('click', click);
        clearBox();
        armedActive = false;
        shiftPressed = false;
        syncSelectionCursor(true);
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
      if (progressMaskCanvas) {
        map.off('move', drawProgressMask);
        map.off('resize', drawProgressMask);
        progressMaskCanvas.remove();
        progressMaskCanvas = null;
        progressMaskContext = null;
        progressMaskCutoutCanvas = null;
        progressMaskCutoutContext = null;
      }
      overlayCursor = '';
      selectionCursorActive = false;
      ignoreNextMapClick = false;
      syncCursor();
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
