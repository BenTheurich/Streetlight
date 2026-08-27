'use client';

import { useEffect, useRef } from 'react';
import type { MapOverlayLifecycle } from '@/lib/map-overlay-lifecycle';
import type { BoundaryShape, Position } from '@/lib/territory-geometry';
import type { ApartmentSelectionSource } from '@/lib/territory-map-style';
import type { ApartmentSite, TerritorySegment } from '@/lib/territory-workspace';

type OpenTerritoryMapProps = {
  visible: boolean;
  interactive: boolean;
  lifecycle: MapOverlayLifecycle | null;
  center: Position;
  radiusMiles: number;
  boundaryShape: BoundaryShape;
  segments: TerritorySegment[];
  apartmentSites: ApartmentSite[];
  mutationLocked: boolean;
  selectedSegmentIds: string[];
  roadFocusRequest: { ids: string[]; key: number } | null;
  showHiddenRoads: boolean;
  boxSelectionArmed: boolean;
  onBoxSelectionComplete: () => void;
  onSelectSegments: (ids: string[], additive: boolean) => void;
  onSelectApartment: (id: string) => void;
  groupingMemberIds: string[] | null;
  onToggleApartmentMember: (id: string) => void;
  selectedApartmentId: string | null;
  selectedApartmentPosition: Position | null;
  apartmentSelectionSource: ApartmentSelectionSource | null;
};

export function OpenTerritoryMap({
  visible,
  interactive,
  lifecycle,
  center,
  radiusMiles,
  boundaryShape,
  segments,
  apartmentSites,
  mutationLocked,
  selectedSegmentIds,
  roadFocusRequest,
  showHiddenRoads,
  boxSelectionArmed,
  onBoxSelectionComplete,
  onSelectSegments,
  onSelectApartment,
  groupingMemberIds,
  onToggleApartmentMember,
  selectedApartmentId,
  selectedApartmentPosition,
  apartmentSelectionSource,
}: OpenTerritoryMapProps) {
  const callbacksRef = useRef({
    onBoxSelectionComplete,
    onSelectApartment,
    onSelectSegments,
    onToggleApartmentMember,
  });
  const releaseRef = useRef<{
    lifecycle: MapOverlayLifecycle;
    release: () => void;
  } | null>(null);
  callbacksRef.current = {
    onBoxSelectionComplete,
    onSelectApartment,
    onSelectSegments,
    onToggleApartmentMember,
  };

  useEffect(() => {
    if (!lifecycle) return;
    const previous = releaseRef.current;
    releaseRef.current = {
      lifecycle,
      release: lifecycle.present({
        kind: 'territory',
        visible,
        interactive,
        center,
        radiusMiles,
        boundaryShape,
        segments,
        apartments: apartmentSites,
        mutationLocked,
        selectedSegmentIds,
        roadFocusRequest,
        showHiddenRoads,
        boxSelectionArmed,
        onBoxSelectionComplete: () => callbacksRef.current.onBoxSelectionComplete(),
        onSelectSegments: (ids, additive) => callbacksRef.current.onSelectSegments(ids, additive),
        onSelectApartment: (id) => callbacksRef.current.onSelectApartment(id),
        groupingMemberIds,
        onToggleApartmentMember: (id) => callbacksRef.current.onToggleApartmentMember(id),
        selectedApartmentId,
        selectedApartmentPosition,
        apartmentSelectionSource,
      }),
    };
    previous?.release();
  }, [
    apartmentSelectionSource,
    apartmentSites,
    boundaryShape,
    boxSelectionArmed,
    center,
    groupingMemberIds,
    interactive,
    lifecycle,
    mutationLocked,
    radiusMiles,
    roadFocusRequest,
    segments,
    selectedApartmentId,
    selectedApartmentPosition,
    selectedSegmentIds,
    showHiddenRoads,
    visible,
  ]);

  useEffect(
    () => () => {
      const current = releaseRef.current;
      if (current?.lifecycle !== lifecycle) return;
      current.release();
      releaseRef.current = null;
    },
    [lifecycle],
  );
  return null;
}
