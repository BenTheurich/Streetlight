'use client';

import { useEffect } from 'react';
import type { MapOverlayLifecycle } from '@/lib/map-overlay-lifecycle';
import type { PacketProposal } from '@/lib/packet-selection';

export function PacketProposalMap({
  active,
  lifecycle,
  proposals,
  selectedIndex,
}: {
  active: boolean;
  lifecycle: MapOverlayLifecycle | null;
  proposals: PacketProposal[];
  selectedIndex: number | null;
}) {
  useEffect(() => {
    if (!lifecycle) return;
    return lifecycle.present({ kind: 'proposals', visible: active, proposals, selectedIndex });
  }, [active, lifecycle, proposals, selectedIndex]);
  return null;
}
