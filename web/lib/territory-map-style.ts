export function segmentStrokeWeight(zoom: number): number {
  return Math.min(5, Math.max(2, zoom - 10));
}

type SegmentMapInput = {
  id: string;
  roadGroupId: string;
  active: boolean;
  eligible: boolean;
  manuallyExcluded: boolean;
};

export function segmentMapAppearance(
  segment: SegmentMapInput,
  selectedSegmentId: string | null,
  selectedHiddenRoadGroupId: string | null,
) {
  const selected =
    segment.active || segment.manuallyExcluded
      ? segment.id === selectedSegmentId
      : segment.roadGroupId === selectedHiddenRoadGroupId;
  if (segment.manuallyExcluded) {
    return {
      strokeColor: selected ? '#3f3c37' : '#77736c',
      strokeOpacity: selected ? 0.95 : 0.5,
      weightOffset: selected ? 2 : 0,
      selectable: true,
      zIndex: 5,
    };
  }
  if (!segment.active) {
    return {
      strokeColor: selected ? '#315f72' : '#6f8794',
      strokeOpacity: selected ? 0.8 : 0.38,
      weightOffset: selected ? 2 : -1,
      selectable: true,
      zIndex: selected ? 3 : 1,
    };
  }
  return {
    strokeColor: selected
      ? segment.eligible
        ? '#9a421f'
        : '#3f3c37'
      : segment.eligible
        ? '#df6d32'
        : '#77736c',
    strokeOpacity: selected ? 0.95 : segment.eligible ? 0.65 : 0.5,
    weightOffset: selected ? 2 : 0,
    selectable: segment.eligible || segment.manuallyExcluded,
    zIndex: selected ? 4 : segment.eligible ? 3 : 2,
  };
}
