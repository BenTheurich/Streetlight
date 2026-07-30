import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import baseStyleJson from './open-map-base-style.json' with { type: 'json' };
import { buildOpenMapStyle, type OpenMapStyle, packetMapView } from './open-map-style.ts';
import type { PacketDownloadSelection } from './packet-finalization.ts';
import type { Position } from './territory-geometry.ts';

export type OpenMapRenderInput = {
  packetId: string;
  start: Position;
  view: { center: Position; zoom: number };
  style: OpenMapStyle;
  attribution: string;
};

type CaptureOpenMaps = (input: OpenMapRenderInput[]) => Promise<Uint8Array[]>;

function escapeScript(value: string): string {
  return value.replaceAll('</script', '<\\/script');
}

export function packetMapDocument(
  input: OpenMapRenderInput,
  maplibreScript: string,
  maplibreCss: string,
): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      ${maplibreCss}
      html, body, #map { width: 1280px; height: 1280px; margin: 0; overflow: hidden; }
      body { background: #f7f8f9; font-family: "Segoe UI", Arial, sans-serif; }
      .start-marker { position: relative; width: 32px; height: 38px; }
      .start-pin {
        position: absolute; left: 3px; top: 2px; width: 27px; height: 27px;
        box-sizing: border-box; border: 3px solid #fff;
        border-radius: 50% 50% 50% 0; background: #0f7055;
        box-shadow: -2px 2px 4px rgba(40, 58, 68, .28);
        transform: rotate(-45deg);
      }
      .start-pin::after {
        content: ""; position: absolute; left: 7px; top: 7px; width: 7px; height: 7px;
        border-radius: 50%; background: #fff;
      }
      .attribution {
        position: absolute; right: 8px; bottom: 7px; z-index: 4;
        padding: 4px 7px; border-radius: 3px; background: rgba(255, 255, 255, .88);
        color: #4d555b; font-size: 14px; line-height: 1.2;
      }
    </style>
  </head>
  <body>
    <div id="map"></div>
    <div class="attribution">${input.attribution}</div>
    <script>${escapeScript(maplibreScript)}</script>
    <script>
      window.__mapReady = false;
      const map = new maplibregl.Map({
        container: "map",
        style: ${escapeScript(JSON.stringify(input.style))},
        center: ${JSON.stringify(input.view.center)},
        zoom: ${input.view.zoom},
        interactive: false,
        attributionControl: false,
        fadeDuration: 0,
        preserveDrawingBuffer: true,
        renderWorldCopies: false
      });
      const marker = document.createElement("div");
      marker.className = "start-marker";
      marker.innerHTML = '<div class="start-pin"></div>';
      new maplibregl.Marker({ element: marker, anchor: "bottom" })
        .setLngLat(${JSON.stringify(input.start)})
        .addTo(map);
      map.once("idle", () => { window.__mapReady = true; });
      map.on("error", (event) => {
        window.__mapError = String(event.error || event.message || "Unknown map error");
      });
    </script>
  </body>
</html>`;
}

async function captureWithPlaywright(input: OpenMapRenderInput[]): Promise<Uint8Array[]> {
  const require = createRequire(import.meta.url);
  const [maplibreScript, maplibreCss] = await Promise.all([
    readFile(require.resolve('maplibre-gl'), 'utf8'),
    readFile(require.resolve('maplibre-gl/dist/maplibre-gl.css'), 'utf8'),
  ]);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 1280 },
      deviceScaleFactor: 1,
      ignoreHTTPSErrors: true,
    });
    const images: Uint8Array[] = [];
    for (const render of input) {
      await page.setContent(packetMapDocument(render, maplibreScript, maplibreCss), {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForFunction(
        () =>
          Boolean(
            (window as unknown as { __mapReady?: boolean; __mapError?: string }).__mapReady ||
              (window as unknown as { __mapReady?: boolean; __mapError?: string }).__mapError,
          ),
        undefined,
        { timeout: 120_000 },
      );
      const mapError = await page.evaluate(
        () => (window as unknown as { __mapError?: string }).__mapError,
      );
      if (mapError) throw new Error(mapError);
      images.push(new Uint8Array(await page.locator('#map').screenshot()));
    }
    return images;
  } finally {
    await browser.close();
  }
}

export async function renderOpenPacketMaps(
  selection: PacketDownloadSelection,
  capture: CaptureOpenMaps = captureWithPlaywright,
): Promise<Map<string, Uint8Array>> {
  const renders = selection.packets.map((packet): OpenMapRenderInput => {
    const generation = selection.mapGenerations.find(
      ({ importGeneration }) => importGeneration === packet.importGeneration,
    );
    if (!generation) throw new Error('Could not render packet maps: import generation missing');
    const view = packetMapView(packet);
    return {
      packetId: packet.id,
      start: packet.start.position,
      view,
      style: buildOpenMapStyle(
        baseStyleJson as unknown as OpenMapStyle,
        packet,
        generation,
        view.zoom,
      ),
      attribution: [
        'OpenFreeMap © OpenMapTiles',
        'Data from OpenStreetMap',
        'Overture Maps',
        ...(generation.buildings.some(({ source }) => source === 'fema')
          ? ['FEMA USA Structures']
          : []),
      ].join(' · '),
    };
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const images = await capture(renders);
      if (images.length !== renders.length) throw new Error('Incomplete map capture');
      return new Map(renders.map((render, index) => [render.packetId, images[index]]));
    } catch (error) {
      if (attempt === 1) {
        throw new Error('Could not render packet maps', { cause: error });
      }
    }
  }
  throw new Error('Could not render packet maps');
}
