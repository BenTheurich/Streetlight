import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import baseStyleJson from './open-map-base-style.json' with { type: 'json' };
import {
  buildOpenMapStyle,
  type OpenMapStyle,
  packetMapView,
  packetStartDisplay,
} from './open-map-style.ts';
import type { PacketDownloadSelection } from './packet-finalization.ts';
import type { Position } from './territory-geometry.ts';
import { mapPinDataUrl } from './territory-map-style.ts';

export type OpenMapRenderInput = {
  packetId: string;
  start: { number: string; position: Position };
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
  const fallbackSource = input.style.sources.streetlightRouteFallbackLabels as
    | {
        data?: {
          features?: Array<{ properties?: { streetNameKey?: string } }>;
        };
      }
    | undefined;
  const fallbackStreetNames = [
    ...new Set(
      (fallbackSource?.data?.features ?? [])
        .map(({ properties }) => properties?.streetNameKey)
        .filter((name): name is string => Boolean(name)),
    ),
  ];
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      ${maplibreCss}
      html, body, #map { width: 1280px; height: 1280px; margin: 0; overflow: hidden; }
      body { background: #f7f8f9; font-family: "Segoe UI", Arial, sans-serif; }
      .start-marker { position: relative; width: 72px; height: 56px; }
      .start-pin {
        position: absolute; left: 8px; top: 0; width: 56px; height: 56px;
      }
      .start-number {
        position: absolute; left: 50%; top: 55px; transform: translateX(-50%);
        color: #26323b; font-size: 16px; font-weight: 700; line-height: 1;
        white-space: nowrap; text-shadow: -1px -1px 0 #fff, 1px -1px 0 #fff,
          -1px 1px 0 #fff, 1px 1px 0 #fff, 0 0 3px #fff;
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
      marker.innerHTML = '<img class="start-pin" alt="" src="${mapPinDataUrl('start')}">';
      const number = document.createElement("div");
      number.className = "start-number";
      number.textContent = ${JSON.stringify(input.start.number)};
      marker.append(number);
      new maplibregl.Marker({ element: marker, anchor: "bottom" })
        .setLngLat(${JSON.stringify(input.start.position)})
        .addTo(map);
      map.once("idle", () => {
        const normalizeStreetName = (value) => {
          if (typeof value !== "string") return "";
          const words = value.trim().toUpperCase().split(/\\s+/);
          const directions = {
            N: "NORTH", S: "SOUTH", E: "EAST", W: "WEST",
            NE: "NORTHEAST", NW: "NORTHWEST", SE: "SOUTHEAST", SW: "SOUTHWEST"
          };
          const suffixes = {
            AVE: "AVENUE", BLVD: "BOULEVARD", CIR: "CIRCLE", CT: "COURT",
            CV: "COVE", DR: "DRIVE", HTS: "HEIGHTS", HWY: "HIGHWAY", LN: "LANE",
            PKWY: "PARKWAY", PL: "PLACE", RD: "ROAD", ST: "STREET",
            TER: "TERRACE", TRL: "TRAIL"
          };
          words[0] = directions[words[0]] || words[0];
          const last = words.length - 1;
          words[last] = suffixes[words[last]] || words[last];
          return words.join(" ");
        };
        const visibleNames = new Set(
          map.queryRenderedFeatures({
            layers: ["highway-name-minor", "highway-name-major"]
          }).flatMap(({ properties = {} }) =>
            [properties.name_en, properties.name, properties["name:latin"]]
              .map(normalizeStreetName)
              .filter(Boolean)
          )
        );
        const missingNames = ${escapeScript(JSON.stringify(fallbackStreetNames))}.filter(
          (name) => !visibleNames.has(name)
        );
        if (missingNames.length === 0) {
          window.__mapReady = true;
          return;
        }
        map.once("idle", () => { window.__mapReady = true; });
        map.addLayer({
          id: "streetlight-route-fallback-labels",
          type: "symbol",
          source: "streetlightRouteFallbackLabels",
          filter: ["in", ["get", "streetNameKey"], ["literal", missingNames]],
          layout: {
            "symbol-placement": "line-center",
            "symbol-avoid-edges": true,
            "text-field": ["get", "streetName"],
            "text-font": ["Noto Sans Bold"],
            "text-rotation-alignment": "map",
            "text-size": ["interpolate", ["linear"], ["zoom"], 14, 12, 18, 17, 20, 19],
            "text-letter-spacing": 0.01,
            "text-allow-overlap": false,
            "text-ignore-placement": false,
            "text-keep-upright": true
          },
          paint: {
            "text-color": "#ffffff",
            "text-halo-blur": 0,
            "text-halo-width": 1,
            "text-halo-color": "#687985"
          }
        });
      });
      map.on("error", (event) => {
        window.__mapError = String(event.error || event.message || "Unknown map error");
      });
    </script>
  </body>
</html>`;
}

export async function captureOpenPacketPages(
  input: OpenMapRenderInput[],
  captureOne: (render: OpenMapRenderInput) => Promise<Uint8Array>,
): Promise<Uint8Array[]> {
  const images = new Array<Uint8Array>(input.length);
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, input.length) }, async () => {
      while (nextIndex < input.length) {
        const index = nextIndex;
        nextIndex += 1;
        images[index] = await captureOne(input[index]);
      }
    }),
  );
  return images;
}

async function captureWithPlaywright(input: OpenMapRenderInput[]): Promise<Uint8Array[]> {
  const maplibreDirectory = path.join(process.cwd(), 'node_modules', 'maplibre-gl', 'dist');
  const [maplibreScript, maplibreCss] = await Promise.all([
    readFile(path.join(maplibreDirectory, 'maplibre-gl.js'), 'utf8'),
    readFile(path.join(maplibreDirectory, 'maplibre-gl.css'), 'utf8'),
  ]);
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 1280 },
      deviceScaleFactor: 1,
      ignoreHTTPSErrors: true,
    });
    try {
      return await captureOpenPacketPages(input, async (render) => {
        const page = await context.newPage();
        try {
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
          return new Uint8Array(await page.locator('#map').screenshot());
        } finally {
          await page.close();
        }
      });
    } finally {
      await context.close();
    }
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
    const start = packetStartDisplay(packet, generation);
    const view = packetMapView(packet, start.position);
    return {
      packetId: packet.id,
      start,
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
