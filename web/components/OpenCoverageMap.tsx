'use client';

import { useEffect } from 'react';
import type {
  CoverageLegendItem,
  CoverageWorkspaceApartment,
  CoverageWorkspaceSegment,
} from '@/lib/coverage';
import type { CoverageSelectionSource } from '@/lib/map-camera';
import type { MapOverlayLifecycle } from '@/lib/map-overlay-lifecycle';
import { coverageColors } from '@/lib/territory-map-style';

type OpenCoverageMapProps = {
  active: boolean;
  interactive: boolean;
  lifecycle: MapOverlayLifecycle | null;
  legend: CoverageLegendItem[];
  segments: CoverageWorkspaceSegment[];
  apartmentComplexes: CoverageWorkspaceApartment[];
  selectedSegmentId: string | null;
  selectionSource: CoverageSelectionSource | null;
  showApartmentMarkers: boolean;
  onOpenMapSettings: () => void;
  onSelectSegment: (id: string) => void;
  fitOnMount?: boolean;
};

export function OpenCoverageMap({
  active,
  interactive,
  lifecycle,
  legend,
  segments,
  apartmentComplexes,
  selectedSegmentId,
  selectionSource,
  showApartmentMarkers,
  onOpenMapSettings,
  onSelectSegment,
  fitOnMount = true,
}: OpenCoverageMapProps) {
  useEffect(() => {
    if (!lifecycle) return;
    return lifecycle.present({
      kind: 'coverage',
      visible: active,
      interactive,
      segments,
      apartments: apartmentComplexes,
      selectedSegmentId,
      selectionSource,
      showApartmentMarkers,
      fitOnFirstShow: fitOnMount,
      onSelectSegment,
    });
  }, [
    active,
    apartmentComplexes,
    fitOnMount,
    interactive,
    lifecycle,
    onSelectSegment,
    segments,
    selectedSegmentId,
    selectionSource,
    showApartmentMarkers,
  ]);

  if (!active) return null;

  return (
    <fieldset className="map-legend coverage-legend">
      <legend className="sr-only">Coverage heatmap legend</legend>
      <button
        aria-label="Open map settings"
        className="coverage-legend-settings"
        onClick={onOpenMapSettings}
        type="button"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>
      {legend.map((item) => (
        <span key={item.coverageClass}>
          <i style={{ background: coverageColors[item.coverageClass] }} />
          {item.label}
        </span>
      ))}
    </fieldset>
  );
}
