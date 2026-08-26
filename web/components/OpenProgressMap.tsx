'use client';

import { useEffect } from 'react';
import type { CoverageWorkspace } from '@/lib/coverage';
import type { MapOverlayLifecycle } from '@/lib/map-overlay-lifecycle';
import type { OutreachProgressPeriod } from '@/lib/outreach-progress';

export function OpenProgressMap({
  active,
  lifecycle,
  progress,
  through,
  workspace,
}: {
  active: boolean;
  lifecycle: MapOverlayLifecycle | null;
  progress: OutreachProgressPeriod;
  through: string | null;
  workspace: CoverageWorkspace;
}) {
  useEffect(() => {
    if (!lifecycle) return;
    return lifecycle.present({ kind: 'progress', visible: active, progress, through, workspace });
  }, [active, lifecycle, progress, through, workspace]);
  if (!active) return null;
  return (
    <fieldset className="map-legend progress-map-legend">
      <legend className="sr-only">Outreach progress legend</legend>
      <span>
        <i className="progress-complete" /> Reached this period
      </span>
      <span>
        <i className="progress-context" /> Region context
      </span>
    </fieldset>
  );
}
