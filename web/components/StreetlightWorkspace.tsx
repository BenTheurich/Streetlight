'use client';

import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { CoverageWorkspace } from '@/lib/coverage';
import { retainCoverageSelection } from '@/lib/coverage';
import type { StreetlightMapType } from '@/lib/google-maps-browser';
import type { CoverageSelectionSource, MapCamera } from '@/lib/map-camera';
import type { MapOverlayLifecycle } from '@/lib/map-overlay-lifecycle';
import type { OpenMapData } from '@/lib/open-map-data';
import {
  buildOutreachProgress,
  type OutreachProgressMode,
  outreachProgressPlayback,
  outreachProgressSnapshot,
  outreachProgressStepCount,
  outreachProgressYears,
} from '@/lib/outreach-progress';
import type { ReviewedPacketGenerationResult } from '@/lib/packet-finalization';
import type { ReconciliationHistoryTarget } from '@/lib/reconciliation';
import { createRegionSetupWorkflow } from '@/lib/region-setup-workflow';
import type { ChurchPrintoutSettings } from '@/lib/settings';
import { territoryMapMode } from '@/lib/territory-client';
import { AdministratorAccount } from './AdministratorAccount';
import { CoverageDashboard } from './CoverageDashboard';
import { HeatmapSettingsOverlay } from './HeatmapSettingsOverlay';
import { MapLayersControl } from './MapLayersControl';
import { OpenCoverageMap } from './OpenCoverageMap';
import { OpenProgressMap } from './OpenProgressMap';
import { OutreachProgress, type ProgressDisplayMode } from './OutreachProgress';
import { PacketGenerator } from './PacketGenerator';
import { PacketProposalMap } from './PacketProposalMap';
import { PrintoutSettings } from './PrintoutSettings';
import { ReconciliationTool } from './ReconciliationTool';
import { TerritoryEditor } from './TerritoryEditor';
import { WorkspaceMap } from './WorkspaceMap';

type WorkspaceTool = 'coverage' | 'packets' | 'progress' | 'setup';
type PacketView = 'generate' | 'reconcile';
type SetupView = 'territory' | 'printouts';

const tools: Array<{ id: WorkspaceTool; label: string; shortLabel: string }> = [
  { id: 'coverage', label: 'Coverage', shortLabel: 'Coverage' },
  { id: 'packets', label: 'Packets', shortLabel: 'Packets' },
  { id: 'progress', label: 'Outreach progress', shortLabel: 'Progress' },
  { id: 'setup', label: 'Setup', shortLabel: 'Setup' },
];

const apartmentMarkerPreferenceKey = 'streetlight:show-apartment-markers';
const progressMillisecondsPerOutreachDay = 2250;
const progressRestMilliseconds = 4000;

function readApartmentMarkerPreference(): boolean {
  try {
    return window.localStorage.getItem(apartmentMarkerPreferenceKey) !== 'false';
  } catch {
    return true;
  }
}

function saveApartmentMarkerPreference(show: boolean): void {
  try {
    window.localStorage.setItem(apartmentMarkerPreferenceKey, String(show));
  } catch {
    return;
  }
}

export function StreetlightWorkspace({
  administratorEmail,
  pendingPilotRequests,
  setupOnly = false,
  initialData,
  initialPrintoutSettings,
  mapsApiKey,
}: {
  administratorEmail: string;
  pendingPilotRequests?: number | null;
  setupOnly?: boolean;
  initialData: CoverageWorkspace;
  initialPrintoutSettings: ChurchPrintoutSettings;
  mapsApiKey: string;
}) {
  const initialYears = outreachProgressYears(initialData);
  const [setupRequired, setSetupOnly] = useState(setupOnly);
  const [tool, setTool] = useState<WorkspaceTool>(setupOnly ? 'setup' : 'coverage');
  const [packetView, setPacketView] = useState<PacketView>('generate');
  const [setupView, setSetupView] = useState<SetupView>('territory');
  const [printoutSettings, setPrintoutSettings] = useState(initialPrintoutSettings);
  const [coverage, setCoverage] = useState(initialData);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(() =>
    retainCoverageSelection(null, initialData.segments),
  );
  const [coverageSelectionSource, setCoverageSelectionSource] =
    useState<CoverageSelectionSource | null>(null);
  const [packetResult, setPacketResult] = useState<ReviewedPacketGenerationResult | null>(null);
  const [selectedPacketIndex, setSelectedPacketIndex] = useState<number | null>(null);
  const [reconciliationTarget, setReconciliationTarget] =
    useState<ReconciliationHistoryTarget | null>(null);
  const [printoutDirty, setPrintoutDirty] = useState(false);
  const [pendingTool, setPendingTool] = useState<WorkspaceTool | null>(null);
  const [pendingSetupView, setPendingSetupView] = useState<SetupView | null>(null);
  const pendingToolRef = useRef<WorkspaceTool | null>(null);
  const pendingSetupViewRef = useRef<SetupView | null>(null);
  pendingToolRef.current = pendingTool;
  pendingSetupViewRef.current = pendingSetupView;
  const [progressYear, setProgressYear] = useState(initialYears[0]);
  const [progressMode, setProgressMode] = useState<OutreachProgressMode>('calendar');
  const [progressPosition, setProgressPosition] = useState<number | null>(null);
  const [progressPlaying, setProgressPlaying] = useState(false);
  const [progressDisplayMode, setProgressDisplayMode] = useState<ProgressDisplayMode>('admin');
  const progressPresentationButtonRef = useRef<HTMLButtonElement>(null);
  const progressPrintCameraRef = useRef<MapCamera | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const setupMap = territoryMapMode(tool, setupView);
  const [mapLifecycle, setMapLifecycle] = useState<MapOverlayLifecycle | null>(null);
  const [mapData, setMapData] = useState<OpenMapData | null>(null);
  const [mapDataError, setMapDataError] = useState('');
  const [mapType, setMapType] = useState<StreetlightMapType>('roadmap');
  const [mapCamera, setMapCamera] = useState<MapCamera>({
    center: initialData.center,
    zoom: 11,
  });
  const [overlayRoot, setOverlayRoot] = useState<HTMLDivElement | null>(null);
  const [heatmapSettingsOpen, setHeatmapSettingsOpen] = useState(false);
  const [showApartmentMarkers, setShowApartmentMarkers] = useState(true);
  useEffect(() => {
    setShowApartmentMarkers(readApartmentMarkerPreference());
  }, []);

  const progressYears = useMemo(() => outreachProgressYears(coverage), [coverage]);
  const progress = useMemo(
    () => buildOutreachProgress(coverage, progressMode === 'calendar' ? progressYear : 'rolling'),
    [coverage, progressMode, progressYear],
  );
  const progressStepCount = outreachProgressStepCount(progress);
  const resolvedProgressPosition = progressPosition ?? progressStepCount;
  const progressPositionRef = useRef(resolvedProgressPosition);
  progressPositionRef.current = resolvedProgressPosition;
  const progressHasDates = progress.dates.length > 0;
  const progressPlayback = outreachProgressPlayback(progress, resolvedProgressPosition);
  const progressSelectedDate = progressPlayback.selectedDate;
  const progressThrough = progressPlayback.through;
  const progressSnapshot = useMemo(
    () => outreachProgressSnapshot(progress, progressThrough),
    [progress, progressThrough],
  );
  const refreshMapData = useCallback(async () => {
    setMapDataError('');
    try {
      const response = await fetch('/api/map');
      const result = (await response.json()) as OpenMapData | { error: string };
      if (!response.ok || 'error' in result) {
        throw new Error('error' in result ? result.error : 'Could not load map data');
      }
      setMapData(result);
    } catch (error) {
      setMapDataError(error instanceof Error ? error.message : 'Could not load map data');
    }
  }, []);
  useEffect(() => {
    void refreshMapData();
  }, [refreshMapData]);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!progressPlaying) return;
    if (reducedMotion || !progressHasDates) {
      setProgressPosition(progressStepCount);
      setProgressPlaying(false);
      return;
    }
    let frame = 0;
    let currentPosition = progressPositionRef.current;
    let previousFrame: number | null = null;
    let restStarted: number | null = null;
    const tick = (time: number) => {
      if (previousFrame === null) previousFrame = time;
      const elapsed = Math.min(time - previousFrame, 100);
      if (elapsed >= 30) {
        previousFrame = time;
        if (currentPosition >= progressStepCount) {
          if (progressDisplayMode !== 'presentation') {
            setProgressPlaying(false);
            return;
          }
          restStarted ??= time;
          if (time - restStarted >= progressRestMilliseconds) {
            currentPosition = 0;
            restStarted = null;
            setProgressPosition(0);
          }
        } else {
          currentPosition = Math.min(
            progressStepCount,
            currentPosition + elapsed / progressMillisecondsPerOutreachDay,
          );
          setProgressPosition(currentPosition);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [progressDisplayMode, progressHasDates, progressPlaying, progressStepCount, reducedMotion]);

  useEffect(() => {
    if (progressDisplayMode !== 'presentation') return;
    const finishPresentation = () => {
      setProgressDisplayMode('admin');
      setProgressPlaying(false);
      setProgressPosition(progressStepCount);
      requestAnimationFrame(() => progressPresentationButtonRef.current?.focus());
    };
    const closeFallback = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.fullscreenElement) {
        finishPresentation();
      }
    };
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) finishPresentation();
    };
    window.addEventListener('keydown', closeFallback);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      window.removeEventListener('keydown', closeFallback);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [progressDisplayMode, progressStepCount]);

  const finishProgressPrint = useCallback(() => {
    setProgressDisplayMode('admin');
    if (progressPrintCameraRef.current) {
      setMapCamera(progressPrintCameraRef.current);
      progressPrintCameraRef.current = null;
    }
  }, []);

  useEffect(() => {
    window.addEventListener('afterprint', finishProgressPrint);
    return () => window.removeEventListener('afterprint', finishProgressPrint);
  }, [finishProgressPrint]);

  const selectCoverageSegment = useCallback((id: string) => {
    setSelectedSegmentId(id);
    setCoverageSelectionSource('map');
  }, []);

  const selectCoverageSearchResult = useCallback((id: string | null) => {
    setSelectedSegmentId(id);
    setCoverageSelectionSource(id ? 'search' : null);
  }, []);

  const refreshCoverage = useCallback(async () => {
    const response = await fetch('/api/coverage');
    const result = (await response.json()) as CoverageWorkspace | { error: string };
    if (!response.ok || 'error' in result) {
      throw new Error('error' in result ? result.error : 'Could not refresh coverage');
    }
    setCoverage(result);
    setSelectedSegmentId((current) => retainCoverageSelection(current, result.segments));
  }, []);

  const finishSetupLeave = useCallback(() => {
    if (pendingToolRef.current) setTool(pendingToolRef.current);
    if (pendingSetupViewRef.current) setSetupView(pendingSetupViewRef.current);
    setPendingTool(null);
    setPendingSetupView(null);
  }, []);

  const handleRegionAccepted = useCallback(
    async ({
      refreshMapData: mapChanged,
      completedInitialSetup,
    }: {
      refreshMapData: boolean;
      completedInitialSetup: boolean;
    }) => {
      setPacketResult(null);
      setSelectedPacketIndex(null);
      const refreshes = [refreshCoverage()];
      if (mapChanged) refreshes.push(refreshMapData());
      await Promise.all(refreshes);
      if (completedInitialSetup) {
        setSetupOnly(false);
        setTool('coverage');
      }
    },
    [refreshCoverage, refreshMapData],
  );

  const [regionSetupWorkflow] = useState(() =>
    createRegionSetupWorkflow({
      initialSetup: setupOnly,
      onAccepted: handleRegionAccepted,
      onLeaveReady: finishSetupLeave,
    }),
  );
  const regionSetup = useSyncExternalStore(
    regionSetupWorkflow.subscribe,
    regionSetupWorkflow.getSnapshot,
    regionSetupWorkflow.getSnapshot,
  );
  useEffect(() => regionSetupWorkflow.start(), [regionSetupWorkflow]);

  function updateApartmentMarkerPreference(show: boolean): void {
    setShowApartmentMarkers(show);
    saveApartmentMarkerPreference(show);
  }

  function openTool(nextTool: WorkspaceTool): void {
    if (nextTool === tool) return;
    if (
      tool === 'setup' &&
      ((setupView === 'territory' &&
        regionSetup.kind === 'ready' &&
        regionSetup.leaveProtection === 'confirm') ||
        (setupView === 'printouts' && printoutDirty))
    ) {
      setPendingTool(nextTool);
      return;
    }
    setHeatmapSettingsOpen(false);
    setProgressDisplayMode('admin');
    setProgressPlaying(false);
    setTool(nextTool);
  }

  function openSetupView(nextView: SetupView): void {
    if (nextView === setupView) return;
    if (
      (setupView === 'territory' &&
        regionSetup.kind === 'ready' &&
        regionSetup.leaveProtection === 'confirm') ||
      (setupView === 'printouts' && printoutDirty)
    ) {
      setPendingSetupView(nextView);
      return;
    }
    setSetupView(nextView);
  }

  function changeProgressYear(year: number): void {
    setProgressYear(year);
    const next = buildOutreachProgress(coverage, year);
    setProgressPosition(outreachProgressStepCount(next));
    setProgressPlaying(false);
  }

  function changeProgressMode(mode: OutreachProgressMode): void {
    setProgressMode(mode);
    const next = buildOutreachProgress(coverage, mode === 'calendar' ? progressYear : 'rolling');
    setProgressPosition(outreachProgressStepCount(next));
    setProgressPlaying(false);
  }

  function playProgress(): void {
    if (progressPlaying) {
      setProgressPlaying(false);
      return;
    }
    if (progress.dates.length === 0) return;
    if (reducedMotion) {
      setProgressPosition(progressStepCount);
      return;
    }
    if (resolvedProgressPosition >= progressStepCount) setProgressPosition(0);
    setProgressPlaying(true);
  }

  function changeProgressDisplayMode(mode: ProgressDisplayMode): void {
    if (mode === 'presentation' && progress.dates.length === 0) return;
    setProgressDisplayMode(mode);
    if (mode === 'presentation') {
      setProgressPosition(reducedMotion ? progressStepCount : 0);
      setProgressPlaying(!reducedMotion);
      void document.documentElement.requestFullscreen?.().catch(() => undefined);
    } else {
      setProgressPlaying(false);
      setProgressPosition(progressStepCount);
      if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => undefined);
      }
      requestAnimationFrame(() => progressPresentationButtonRef.current?.focus());
    }
  }

  function printProgress(): void {
    if (progress.dates.length === 0) return;
    progressPrintCameraRef.current = mapCamera;
    setProgressPlaying(false);
    setProgressPosition(progressStepCount);
    setProgressDisplayMode('print');
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        window.print();
        finishProgressPrint();
      }),
    );
  }

  return (
    <div
      className={`territory-page${progressDisplayMode === 'admin' ? '' : ` progress-stage progress-${progressDisplayMode}`}`}
    >
      <header className="territory-header workspace-header">
        <div className="brand">
          <Image alt="" height="40" src="/landing/streetlight-logo-mark-v2.webp" width="24" />
          <span className="wordmark">Streetlight</span>
          {coverage.dataMode === 'demo' && <span className="demo-data-label">Demo data</span>}
        </div>
        {!setupRequired && (
          <nav aria-label="Administrator tools" className="workspace-tools">
            {tools.map(({ id, label, shortLabel }) => (
              <button
                aria-label={label}
                aria-pressed={tool === id}
                className={tool === id ? 'active' : ''}
                key={id}
                onClick={() => openTool(id)}
                type="button"
              >
                <span className="tool-label-long">{label}</span>
                <span className="tool-label-short">{shortLabel}</span>
              </button>
            ))}
          </nav>
        )}
        <AdministratorAccount
          email={administratorEmail}
          pendingPilotRequests={pendingPilotRequests}
        />
      </header>
      <main className="territory-workspace">
        <section className="map-panel">
          <WorkspaceMap
            apiKey={mapsApiKey}
            camera={mapCamera}
            data={mapData}
            mapType={mapType}
            onCameraChange={setMapCamera}
            onLifecycleChange={setMapLifecycle}
          />
          {mapDataError && (
            <div className="map-unavailable" role="alert">
              <strong>{mapDataError}</strong>
              <button className="secondary" onClick={() => void refreshMapData()} type="button">
                Retry
              </button>
            </div>
          )}
          <MapLayersControl onChange={setMapType} value={mapType} />
          <OpenCoverageMap
            active={tool === 'coverage' || tool === 'packets'}
            apartmentComplexes={coverage.apartmentComplexes}
            interactive={tool === 'coverage'}
            legend={coverage.legend}
            lifecycle={mapLifecycle}
            onOpenMapSettings={() => setHeatmapSettingsOpen(true)}
            onSelectSegment={selectCoverageSegment}
            segments={coverage.segments}
            selectedSegmentId={tool === 'coverage' ? selectedSegmentId : null}
            selectionSource={coverageSelectionSource}
            showApartmentMarkers={showApartmentMarkers}
          />
          <PacketProposalMap
            active={tool === 'packets' && packetView === 'generate'}
            lifecycle={mapLifecycle}
            proposals={packetResult?.proposals ?? []}
            selectedIndex={selectedPacketIndex}
          />
          <OpenProgressMap
            active={tool === 'progress'}
            animated={!reducedMotion}
            cinematic={progressDisplayMode === 'presentation'}
            fitForPrint={progressDisplayMode === 'print'}
            lifecycle={mapLifecycle}
            position={resolvedProgressPosition}
            progress={progress}
            showLegend={progressDisplayMode !== 'presentation'}
            workspace={coverage}
          />
          <HeatmapSettingsOverlay
            onClose={() => setHeatmapSettingsOpen(false)}
            onSaved={setCoverage}
            onShowApartmentMarkersChange={updateApartmentMarkerPreference}
            showApartmentMarkers={showApartmentMarkers}
            open={heatmapSettingsOpen}
            thresholds={coverage.thresholds}
          />
          <div className="map-overlay-root" ref={setOverlayRoot} />
        </section>
        <CoverageDashboard
          active={tool === 'coverage'}
          onOpenPackets={() => {
            setPacketView('generate');
            openTool('packets');
          }}
          onOpenHistory={(packetId) => {
            setReconciliationTarget({ packetId });
            setPacketView('reconcile');
            openTool('packets');
          }}
          onOpenReconciliation={() => {
            setPacketView('reconcile');
            openTool('packets');
          }}
          onSelectSegment={selectCoverageSearchResult}
          selectedSegmentId={selectedSegmentId}
          workspace={coverage}
        />
        <PacketGenerator
          active={tool === 'packets' && packetView === 'generate'}
          activePackets={coverage.activePackets}
          latestBatch={coverage.latestBatch}
          onFinalized={refreshCoverage}
          onResultChange={setPacketResult}
          onSelectedIndexChange={setSelectedPacketIndex}
          onViewChange={setPacketView}
          result={packetResult}
          selectedIndex={selectedPacketIndex}
        />
        <ReconciliationTool
          active={tool === 'packets' && packetView === 'reconcile'}
          lifecycle={mapLifecycle}
          onChanged={refreshCoverage}
          onTargetHandled={() => setReconciliationTarget(null)}
          onViewChange={setPacketView}
          target={reconciliationTarget}
        />
        <OutreachProgress
          active={tool === 'progress'}
          churchName={coverage.churchName}
          displayMode={progressDisplayMode}
          onDisplayModeChange={changeProgressDisplayMode}
          onModeChange={changeProgressMode}
          onPlay={playProgress}
          onPrint={printProgress}
          onStepChange={(step) => {
            setProgressPosition(step);
            setProgressPlaying(false);
          }}
          onYearChange={changeProgressYear}
          playing={progressPlaying}
          presentationButtonRef={progressPresentationButtonRef}
          progress={progress}
          position={resolvedProgressPosition}
          selectedDate={progressSelectedDate}
          snapshot={progressSnapshot}
          stepCount={progressStepCount}
          timelinePosition={progressPlayback.barPosition}
          year={progressYear}
          years={progressYears}
        />
        {regionSetup.kind === 'ready' && (
          <TerritoryEditor
            active={setupMap.interactive}
            lifecycle={mapLifecycle}
            mapVisible={setupMap.visible}
            mapsApiKey={mapsApiKey}
            onReturnToSetup={() => {
              setTool('setup');
              setSetupView('territory');
            }}
            onStay={() => {
              setPendingTool(null);
              setPendingSetupView(null);
            }}
            onViewChange={openSetupView}
            overlayRoot={overlayRoot}
            pendingLeave={pendingTool !== null || pendingSetupView !== null}
            view={regionSetup}
            workflow={regionSetupWorkflow}
          />
        )}
        <PrintoutSettings
          active={tool === 'setup' && setupView === 'printouts'}
          onDirtyChange={setPrintoutDirty}
          onDiscardAndLeave={finishSetupLeave}
          onSaved={setPrintoutSettings}
          onSaveAndLeave={finishSetupLeave}
          onStay={() => {
            setPendingTool(null);
            setPendingSetupView(null);
          }}
          onViewChange={(view) => openSetupView(view as SetupView)}
          pendingLeave={pendingTool !== null || pendingSetupView !== null}
          settings={printoutSettings}
        />
        {tool === 'setup' && setupView === 'territory' && regionSetup.kind !== 'ready' && (
          <aside className="territory-sidebar">
            <div className="sidebar-scroll">
              <p
                className={regionSetup.kind === 'unavailable' ? 'field-error' : 'empty-state'}
                role={regionSetup.kind === 'unavailable' ? 'alert' : undefined}
              >
                {regionSetup.kind === 'unavailable' ? regionSetup.message : 'Loading saved region…'}
              </p>
              {regionSetup.kind === 'unavailable' && (
                <button
                  onClick={() => {
                    void regionSetupWorkflow.recover();
                  }}
                  type="button"
                >
                  Retry
                </button>
              )}
            </div>
          </aside>
        )}
      </main>
    </div>
  );
}
