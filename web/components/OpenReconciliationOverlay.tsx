'use client';

import { useEffect } from 'react';
import type { MapOverlayLifecycle } from '@/lib/map-overlay-lifecycle';
import type { ReconciliationMapPresentation } from '@/lib/reconciliation';

export function OpenReconciliationOverlay({
  active,
  lifecycle,
  presentation,
}: {
  active: boolean;
  lifecycle: MapOverlayLifecycle | null;
  presentation: ReconciliationMapPresentation;
}) {
  useEffect(() => {
    if (!lifecycle) return;
    return lifecycle.present({
      kind: 'reconciliation',
      visible: active,
      presentation,
    });
  }, [active, lifecycle, presentation]);
  return null;
}
