'use client';

import { useEffect, useRef } from 'react';
import type { CoverageWorkspace } from '@/lib/coverage';
import type { MapOverlayLifecycle } from '@/lib/map-overlay-lifecycle';
import type { OutreachProgressPeriod } from '@/lib/outreach-progress';

export function OpenProgressMap({
  active,
  animated,
  cinematic,
  fitForPrint,
  lifecycle,
  position,
  progress,
  showLegend,
  workspace,
}: {
  active: boolean;
  animated: boolean;
  cinematic: boolean;
  fitForPrint: boolean;
  lifecycle: MapOverlayLifecycle | null;
  position: number;
  progress: OutreachProgressPeriod;
  showLegend: boolean;
  workspace: CoverageWorkspace;
}) {
  const releaseRef = useRef<{
    lifecycle: MapOverlayLifecycle;
    release: () => void;
  } | null>(null);

  useEffect(() => {
    if (!lifecycle) return;
    const previous = releaseRef.current;
    releaseRef.current = {
      lifecycle,
      release: lifecycle.present({
        animated,
        cinematic,
        fitForPrint,
        kind: 'progress',
        position,
        visible: active,
        progress,
        workspace,
      }),
    };
    previous?.release();
  }, [active, animated, cinematic, fitForPrint, lifecycle, position, progress, workspace]);

  useEffect(
    () => () => {
      const current = releaseRef.current;
      if (current?.lifecycle !== lifecycle) return;
      current.release();
      releaseRef.current = null;
    },
    [lifecycle],
  );
  if (!active || !showLegend) return null;
  return (
    <fieldset className="map-legend progress-map-legend">
      <legend className="sr-only">Outreach progress legend</legend>
      <span>
        <i className="progress-complete" /> Completed by this date
      </span>
      <span>
        <i className="progress-context" /> Other region streets
      </span>
    </fieldset>
  );
}
