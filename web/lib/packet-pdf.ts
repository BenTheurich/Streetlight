import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import QRCode from 'qrcode';
import type { DownloadPacket, PacketDownloadSelection } from './packet-finalization.ts';
import type { Position } from './territory-geometry.ts';

const roadsUrl = 'https://roads.googleapis.com/v1/snapToRoads';
const staticMapsUrl = 'https://maps.googleapis.com/maps/api/staticmap';

export function googleMapsDirectionsUrl(address: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}&travelmode=walking`;
}

function encodePolyline(coordinates: Position[]): string {
  let previousLatitude = 0;
  let previousLongitude = 0;
  let result = '';
  for (const [longitude, latitude] of coordinates) {
    const currentLatitude = Math.round(latitude * 100_000);
    const currentLongitude = Math.round(longitude * 100_000);
    for (const delta of [
      currentLatitude - previousLatitude,
      currentLongitude - previousLongitude,
    ]) {
      let value = delta < 0 ? ~(delta << 1) : delta << 1;
      while (value >= 0x20) {
        result += String.fromCharCode((0x20 | (value & 0x1f)) + 63);
        value >>= 5;
      }
      result += String.fromCharCode(value + 63);
    }
    previousLatitude = currentLatitude;
    previousLongitude = currentLongitude;
  }
  return result;
}

function coordinateChunks(coordinates: Position[]): Position[][] {
  if (coordinates.length <= 100) return [coordinates];
  const chunks: Position[][] = [];
  for (let start = 0; start < coordinates.length - 1; start += 99) {
    chunks.push(coordinates.slice(start, Math.min(start + 100, coordinates.length)));
  }
  return chunks;
}

async function snapCoordinates(
  coordinates: Position[],
  apiKey: string,
  fetchMap: typeof fetch,
): Promise<Position[]> {
  const snapped: Position[] = [];
  for (const chunk of coordinateChunks(coordinates)) {
    const parameters = new URLSearchParams({
      interpolate: 'true',
      path: chunk.map(([longitude, latitude]) => `${latitude},${longitude}`).join('|'),
      key: apiKey,
    });
    const response = await fetchMap(`${roadsUrl}?${parameters}`);
    if (!response.ok) throw new Error('Google Roads could not snap a packet map');
    const payload = (await response.json()) as {
      snappedPoints?: Array<{ location?: { longitude?: number; latitude?: number } }>;
    };
    const points = (payload.snappedPoints ?? []).flatMap(({ location }) =>
      typeof location?.longitude === 'number' && typeof location.latitude === 'number'
        ? ([[location.longitude, location.latitude]] as Position[])
        : [],
    );
    if (points.length < 2) throw new Error('Google Roads returned no usable packet path');
    snapped.push(...(snapped.length > 0 ? points.slice(1) : points));
  }
  return snapped;
}

export async function renderPacketMap(
  packet: DownloadPacket,
  apiKey: string,
  fetchMap: typeof fetch = fetch,
): Promise<Uint8Array> {
  const paths: Position[][] = [];
  for (const segment of packet.segments) {
    paths.push(await snapCoordinates(segment.geometry.coordinates, apiKey, fetchMap));
  }
  const parameters = new URLSearchParams({
    size: '640x640',
    scale: '2',
    format: 'png',
    maptype: 'roadmap',
    language: 'en',
    region: 'us',
  });
  for (const path of paths) {
    parameters.append('path', `color:0xef6c3599|weight:6|enc:${encodePolyline(path)}`);
  }
  parameters.append(
    'markers',
    `${packet.start.position[1].toFixed(7)},${packet.start.position[0].toFixed(7)}`,
  );
  parameters.append('key', apiKey);
  const response = await fetchMap(`${staticMapsUrl}?${parameters}`);
  if (!response.ok || response.headers.get('content-type')?.startsWith('image/') !== true) {
    throw new Error('Google Static Maps could not render a packet map');
  }
  return new Uint8Array(await response.arrayBuffer());
}

type RenderPacketPdfOptions = {
  logo: Uint8Array;
  renderMap: (packet: DownloadPacket) => Promise<Uint8Array>;
};

export async function renderPacketPdf(
  selection: PacketDownloadSelection,
  options: RenderPacketPdfOptions,
): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.setTitle(
    selection.scope === 'active'
      ? 'Streetlight active outreach packets'
      : `Streetlight packet batch - ${selection.packets[0]?.batchName ?? 'Newest'}`,
  );
  document.setCreator('Streetlight');
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const logo = await document.embedPng(options.logo);
  const ink = rgb(49 / 255, 44 / 255, 38 / 255);
  const muted = rgb(116 / 255, 109 / 255, 100 / 255);
  const border = rgb(215 / 255, 209 / 255, 200 / 255);
  const panel = rgb(247 / 255, 243 / 255, 236 / 255);

  for (const packet of selection.packets) {
    const mapBytes = await options.renderMap(packet);
    const map = await document.embedPng(mapBytes);
    const qr = await document.embedPng(
      await QRCode.toBuffer(googleMapsDirectionsUrl(packet.start.address), {
        type: 'png',
        width: 344,
        margin: 1,
        errorCorrectionLevel: 'M',
      }),
    );
    const page = document.addPage([612, 792]);

    page.drawRectangle({
      x: 304,
      y: 664,
      width: 293,
      height: 112,
      color: panel,
      borderColor: border,
      borderWidth: 0.5,
    });
    page.drawText('ESTIMATED HOMES / TRACTS', {
      x: 22,
      y: 752,
      size: 9,
      font: bold,
      color: muted,
    });
    page.drawText(String(packet.estimatedHomes), {
      x: 22,
      y: 704,
      size: 38,
      font: bold,
      color: ink,
    });
    page.drawText('STARTING ADDRESS', {
      x: 318,
      y: 752,
      size: 8,
      font: bold,
      color: muted,
    });
    const [street, ...locality] = packet.start.address.split(', ');
    page.drawText(street, { x: 318, y: 724, size: 12, font: bold, color: ink });
    page.drawText(locality.join(', '), { x: 318, y: 705, size: 10.5, font: bold, color: ink });
    page.drawRectangle({ x: 497, y: 681, width: 94, height: 94, color: rgb(1, 1, 1) });
    page.drawImage(qr, { x: 501, y: 685, width: 86, height: 86 });
    page.drawText('SCAN FOR DIRECTIONS', {
      x: 504,
      y: 671,
      size: 7.2,
      font: bold,
      color: muted,
    });

    page.drawImage(map, { x: 15, y: 70, width: 582, height: 582 });
    page.drawRectangle({
      x: 15,
      y: 70,
      width: 582,
      height: 582,
      borderColor: border,
      borderWidth: 0.5,
    });

    page.drawImage(logo, { x: 15, y: 24, width: 20, height: 20 });
    page.drawText('STREETLIGHT', { x: 42, y: 31, size: 9, font: bold, color: ink });
    const codeWidth = bold.widthOfTextAtSize(packet.code, 9.5);
    page.drawText('PACKET', {
      x: 597 - codeWidth - 42,
      y: 34,
      size: 7,
      font: bold,
      color: muted,
    });
    page.drawText(packet.code, {
      x: 597 - codeWidth,
      y: 32,
      size: 9.5,
      font: bold,
      color: ink,
    });
  }
  return document.save({ useObjectStreams: false });
}
