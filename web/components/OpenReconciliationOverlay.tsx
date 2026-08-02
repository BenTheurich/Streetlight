'use client';

import type { Map as MapLibreMap, Marker as MapLibreMarker } from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import { positionBounds } from '@/lib/map-camera';
import type { ReconciliationBatch, ReconciliationPacket } from '@/lib/reconciliation';

const dispositionColors = {
  complete: '#3e8b65',
  active: '#1769ff',
  cancel: '#77736c',
};

export function OpenReconciliationOverlay({
  active,
  batch,
  cancelIds,
  map,
  presentIds,
  selectedPacketId,
}: {
  active: boolean;
  batch: ReconciliationBatch | null;
  cancelIds: Set<string>;
  map: MapLibreMap | null;
  presentIds: Set<string>;
  selectedPacketId: string | null;
}) {
  const lastFocusRef = useRef('');

  useEffect(() => {
    if (!active || !map || !batch) return;
    const sourceId = 'streetlight-reconciliation';
    const haloId = 'streetlight-reconciliation-halo';
    const lineId = 'streetlight-reconciliation-line';
    const markers: MapLibreMarker[] = [];
    let disposed = false;
    const activePackets = batch.packets.filter(({ status }) => status === 'active');
    const selected = batch.packets.find(({ id }) => id === selectedPacketId) ?? null;
    const packets = [
      ...activePackets,
      ...(selected && selected.status !== 'active' ? [selected] : []),
    ];
    const disposition = (packet: ReconciliationPacket) =>
      packet.status === 'cancelled' || cancelIds.has(packet.id)
        ? 'cancel'
        : packet.status === 'completed' || !presentIds.has(packet.id)
          ? 'complete'
          : 'active';
    map.addSource(sourceId, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: packets.flatMap((packet) =>
          packet.segments.map((segment) => ({
            type: 'Feature' as const,
            geometry: segment.geometry,
            properties: {
              color: dispositionColors[disposition(packet)],
              selected: packet.id === selectedPacketId,
            },
          })),
        ),
      },
    });
    const before = map.getLayer('highway-name-minor') ? 'highway-name-minor' : undefined;
    map.addLayer(
      {
        id: haloId,
        type: 'line',
        source: sourceId,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#ffffff',
          'line-opacity': 0.9,
          'line-width': [
            '+',
            ['interpolate', ['linear'], ['zoom'], 11, 5, 14, 7],
            ['case', ['get', 'selected'], 6, 4],
          ],
        },
      },
      before,
    );
    map.addLayer(
      {
        id: lineId,
        type: 'line',
        source: sourceId,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-opacity': 0.9,
          'line-width': [
            '+',
            ['interpolate', ['linear'], ['zoom'], 11, 5, 14, 7],
            ['case', ['get', 'selected'], 2, 0],
          ],
        },
      },
      before,
    );
    const focusPackets = selected ? [selected] : packets;
    const positions = focusPackets.flatMap((packet) => [
      ...packet.segments.flatMap(({ geometry }) => geometry.coordinates),
      ...(packet.apartment ? [packet.apartment.position] : []),
    ]);
    const focusKey = `${batch.id}:${selectedPacketId ?? 'all'}`;
    const bounds = positionBounds(positions);
    if (lastFocusRef.current !== focusKey && bounds) {
      map.fitBounds(bounds, { padding: 56 });
      lastFocusRef.current = focusKey;
    }
    void import('maplibre-gl').then(({ Marker }) => {
      if (disposed) return;
      for (const packet of packets.filter(({ apartment }) => apartment)) {
        if (packet.id === selectedPacketId) continue;
        const content = document.createElement('span');
        content.className = 'reconciliation-apartment-marker';
        content.style.setProperty('--reconciliation-color', dispositionColors[disposition(packet)]);
        content.textContent = 'A';
        content.title = `${packet.code} · ${packet.estimatedTracts} estimated tract${packet.estimatedTracts === 1 ? '' : 's'}`;
        markers.push(
          new Marker({ element: content })
            .setLngLat(packet.apartment?.position as [number, number])
            .addTo(map),
        );
      }
      if (selected) {
        const marker = new Marker({ color: '#101a29' })
          .setLngLat(selected.start.position)
          .addTo(map);
        marker.getElement().title = `Starting address: ${selected.start.address}`;
        markers.push(marker);
      }
    });
    return () => {
      disposed = true;
      for (const marker of markers) marker.remove();
      if (map.getLayer(lineId)) map.removeLayer(lineId);
      if (map.getLayer(haloId)) map.removeLayer(haloId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    };
  }, [active, batch, cancelIds, map, presentIds, selectedPacketId]);

  return null;
}
