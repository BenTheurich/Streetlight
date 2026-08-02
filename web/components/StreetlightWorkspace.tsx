'use client';

import type { Map as MapLibreMap } from 'maplibre-gl';
import Image from 'next/image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { retainCoverageSelection } from '@/lib/coverage';
import type { CoverageWorkspace, OpenMapData, TerritoryWorkspace } from '@/lib/database';
import type { StreetlightMapType } from '@/lib/google-maps-browser';
import type { CoverageSelectionSource, MapCamera } from '@/lib/map-camera';
import {
  buildOutreachProgress,
  outreachProgressSnapshot,
  outreachProgressYears,
} from '@/lib/outreach-progress';
import type { ReviewedPacketGenerationResult } from '@/lib/packet-finalization';
import type { ChurchPrintoutSettings } from '@/lib/settings';
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
  const [territory, setTerritory] = useState<TerritoryWorkspace | null>(null);
  const [territoryLoading, setTerritoryLoading] = useState(false);
  const [territoryError, setTerritoryError] = useState('');
  const [territoryDirty, setTerritoryDirty] = useState(false);
  const [territorySaving, setTerritorySaving] = useState(false);
  const [pendingTool, setPendingTool] = useState<WorkspaceTool | null>(null);
  const [pendingSetupView, setPendingSetupView] = useState<SetupView | null>(null);
  const [progressYear, setProgressYear] = useState(initialYears[0]);
  const [progressStep, setProgressStep] = useState<number | null>(null);
  const [progressPlaying, setProgressPlaying] = useState(false);
  const [progressDisplayMode, setProgressDisplayMode] = useState<ProgressDisplayMode>('admin');
  const [reducedMotion, setReducedMotion] = useState(false);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [mapData, setMapData] = useState<OpenMapData | null>(null);
  const [mapDataError, setMapDataError] = useState('');
  const [mapType, setMapType] = useState<StreetlightMapType>('roadmap');
  const [mapCamera, setMapCamera] = useState<MapCamera>({
    center: initialData.center,
    zoom: 11,
  });
  const [overlayRoot, setOverlayRoot] = useState<HTMLDivElement | null>(null);
  const [heatmapSettingsOpen, setHeatmapSettingsOpen] = useState(false);
  const progressYears = useMemo(() => outreachProgressYears(coverage), [coverage]);
  const progress = useMemo(
    () => buildOutreachProgress(coverage, progressYear),
    [coverage, progressYear],
  );
  const resolvedProgressStep = progressStep ?? progress.dates.length;
  const progressThrough =
    resolvedProgressStep > 0 ? (progress.dates[resolvedProgressStep - 1] ?? null) : null;
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
  const loadTerritory = useCallback(async () => {
    setTerritoryLoading(true);
    setTerritoryError('');
    try {
      const response = await fetch('/api/territory');
      const result = (await response.json()) as TerritoryWorkspace | { error: string };
      if (!response.ok || 'error' in result) {
        throw new Error('error' in result ? result.error : 'Could not load territory');
      }
      setTerritory(result);
    } catch (error) {
      setTerritoryError(error instanceof Error ? error.message : 'Could not load territory');
    } finally {
      setTerritoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshMapData();
  }, [refreshMapData]);

  useEffect(() => {
    if (
      tool === 'setup' &&
      setupView === 'territory' &&
      !territory &&
      !territoryLoading &&
      !territoryError
    ) {
      void loadTerritory();
    }
  }, [loadTerritory, setupView, territory, territoryError, territoryLoading, tool]);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!progressPlaying) return;
    if (reducedMotion || progress.dates.length === 0) {
      setProgressStep(progress.dates.length);
      setProgressPlaying(false);
      return;
    }
    const atEnd = resolvedProgressStep >= progress.dates.length;
    const timeout = window.setTimeout(
      () => {
        if (atEnd) {
          if (progressDisplayMode === 'presentation') setProgressStep(0);
          else setProgressPlaying(false);
        } else {
          setProgressStep(resolvedProgressStep + 1);
        }
      },
      atEnd ? 4000 : 850,
    );
    return () => window.clearTimeout(timeout);
  }, [
    progress.dates.length,
    progressDisplayMode,
    progressPlaying,
    reducedMotion,
    resolvedProgressStep,
  ]);

  useEffect(() => {
    if (progressDisplayMode !== 'presentation') return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setProgressDisplayMode('admin');
        setProgressPlaying(false);
        setProgressStep(progress.dates.length);
      }
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [progress.dates.length, progressDisplayMode]);

  useEffect(() => {
    const finishPrint = () => setProgressDisplayMode('admin');
    window.addEventListener('afterprint', finishPrint);
    return () => window.removeEventListener('afterprint', finishPrint);
  }, []);

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

  const refreshAfterTerritorySave = useCallback(
    async (saved: TerritoryWorkspace) => {
      const completingSetup = setupRequired;
      setTerritory(saved);
      setPacketResult(null);
      setSelectedPacketIndex(null);
      await Promise.all([refreshCoverage(), refreshMapData()]);
      setSetupOnly(false);
      if (completingSetup) setTool('coverage');
    },
    [refreshCoverage, refreshMapData, setupRequired],
  );

  function openTool(nextTool: WorkspaceTool): void {
    if (nextTool === tool) return;
    if (tool === 'setup' && setupView === 'territory' && territoryDirty && !territorySaving) {
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
    if (setupView === 'territory' && territoryDirty && !territorySaving) {
      setPendingSetupView(nextView);
      return;
    }
    setSetupView(nextView);
  }

  function finishTerritoryLeave(): void {
    if (pendingTool) setTool(pendingTool);
    if (pendingSetupView) setSetupView(pendingSetupView);
    setPendingTool(null);
    setPendingSetupView(null);
  }

  function changeProgressYear(year: number): void {
    setProgressYear(year);
    const next = buildOutreachProgress(coverage, year);
    setProgressStep(next.dates.length);
    setProgressPlaying(false);
  }

  function playProgress(): void {
    setProgressStep(reducedMotion ? progress.dates.length : 0);
    setProgressPlaying(!reducedMotion && progress.dates.length > 0);
  }

  function changeProgressDisplayMode(mode: ProgressDisplayMode): void {
    setProgressDisplayMode(mode);
    if (mode === 'presentation') playProgress();
    else {
      setProgressPlaying(false);
      setProgressStep(progress.dates.length);
    }
  }

  function printProgress(): void {
    setProgressPlaying(false);
    setProgressStep(progress.dates.length);
    setProgressDisplayMode('print');
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
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
            onMapChange={setMap}
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
            map={map}
            onEditHeatmapRanges={() => setHeatmapSettingsOpen(true)}
            onSelectSegment={selectCoverageSegment}
            segments={coverage.segments}
            selectedSegmentId={tool === 'coverage' ? selectedSegmentId : null}
            selectionSource={coverageSelectionSource}
          />
          <PacketProposalMap
            active={tool === 'packets' && packetView === 'generate'}
            map={map}
            proposals={packetResult?.proposals ?? []}
            selectedIndex={selectedPacketIndex}
          />
          <OpenProgressMap
            active={tool === 'progress'}
            map={map}
            progress={progress}
            through={progressThrough}
            workspace={coverage}
          />
          <HeatmapSettingsOverlay
            onClose={() => setHeatmapSettingsOpen(false)}
            onSaved={setCoverage}
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
          qualityWarnings={coverage.qualityWarnings}
          onFinalized={refreshCoverage}
          onResultChange={setPacketResult}
          onSelectedIndexChange={setSelectedPacketIndex}
          onViewChange={setPacketView}
          result={packetResult}
          selectedIndex={selectedPacketIndex}
        />
        <ReconciliationTool
          active={tool === 'packets' && packetView === 'reconcile'}
          map={map}
          onChanged={refreshCoverage}
          onViewChange={setPacketView}
        />
        <OutreachProgress
          active={tool === 'progress'}
          churchName={coverage.churchName}
          displayMode={progressDisplayMode}
          onDisplayModeChange={changeProgressDisplayMode}
          onPlay={playProgress}
          onPrint={printProgress}
          onStepChange={(step) => {
            setProgressStep(step);
            setProgressPlaying(false);
          }}
          onYearChange={changeProgressYear}
          playing={progressPlaying}
          progress={progress}
          snapshot={progressSnapshot}
          step={resolvedProgressStep}
          through={progressThrough}
          year={progressYear}
          years={progressYears}
        />
        {territory && (
          <TerritoryEditor
            active={tool === 'setup' && setupView === 'territory'}
            initialData={territory}
            map={map}
            onDirtyChange={setTerritoryDirty}
            onDiscardAndLeave={finishTerritoryLeave}
            onImportingChange={setTerritorySaving}
            onReturnToSetup={() => {
              setTool('setup');
              setSetupView('territory');
            }}
            onSaved={refreshAfterTerritorySave}
            onSaveAndLeave={finishTerritoryLeave}
            onStay={() => {
              setPendingTool(null);
              setPendingSetupView(null);
            }}
            onViewChange={openSetupView}
            overlayRoot={overlayRoot}
            pendingLeave={pendingTool !== null || pendingSetupView !== null}
            setupRequired={setupRequired}
          />
        )}
        <PrintoutSettings
          active={tool === 'setup' && setupView === 'printouts'}
          onSaved={setPrintoutSettings}
          onViewChange={(view) => openSetupView(view as SetupView)}
          settings={printoutSettings}
        />
        {tool === 'setup' && setupView === 'territory' && !territory && (
          <aside className="territory-sidebar">
            <div className="sidebar-scroll">
              <p
                className={territoryError ? 'field-error' : 'empty-state'}
                role={territoryError ? 'alert' : undefined}
              >
                {territoryError ||
                  (territoryLoading ? 'Loading saved territory…' : 'Saved territory unavailable.')}
              </p>
              {territoryError && (
                <button
                  onClick={() => {
                    setTerritoryError('');
                    void loadTerritory();
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
