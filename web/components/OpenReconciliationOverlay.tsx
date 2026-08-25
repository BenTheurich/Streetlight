'use client';

import { useEffect } from 'react';
import type { MapOverlayLifecycle } from '@/lib/map-overlay-lifecycle';
import type { ReconciliationBatch } from '@/lib/reconciliation';

export function OpenReconciliationOverlay({
  active,
  batch,
  cancelIds,
  history,
  lifecycle,
  presentIds,
  selectedPacketId,
}: {
  active: boolean;
  batch: ReconciliationBatch | null;
  cancelIds: Set<string>;
  history: boolean;
  lifecycle: MapOverlayLifecycle | null;
  presentIds: Set<string>;
  selectedPacketId: string | null;
}) {
  useEffect(() => {
    if (!lifecycle) return;
    return lifecycle.present({
      kind: 'reconciliation',
      visible: active,
      batch,
      history,
      presentIds,
      cancelIds,
      selectedPacketId,
    });
  }, [active, batch, cancelIds, history, lifecycle, presentIds, selectedPacketId]);
  return null;
}
