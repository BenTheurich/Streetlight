'use client';

import Image from 'next/image';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CoverageWorkspace } from '@/lib/coverage';
import { retainCoverageSelection } from '@/lib/coverage';
import type { StreetlightMapType } from '@/lib/google-maps-browser';
import type { CoverageSelectionSource, MapCamera } from '@/lib/map-camera';
import type { MapOverlayLifecycle } from '@/lib/map-overlay-lifecycle';
import type { OpenMapData } from '@/lib/open-map-data';
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
import { OutreachProgress } from './OutreachProgress';
import { PacketGenerator } from './PacketGenerator';
import { PacketProposalMap } from './PacketProposalMap';
import { PrintoutSettings } from './PrintoutSettings';
import { ReconciliationTool } from './ReconciliationTool';
import { TerritoryEditor } from './TerritoryEditor';
import { useOutreachProgress } from './useOutreachProgress';
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

  const {
    view: progressView,
    act: progressAction,
    presentationButtonRef,
  } = useOutreachProgress({
    active: tool === 'progress',
    coverage,
    camera: mapCamera,
    lifecycle: mapLifecycle,
    onCameraChange: setMapCamera,
  });
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

  return (
    <div
      className={`territory-page${progressView.displayMode === 'admin' ? '' : ` progress-stage progress-${progressView.displayMode}`}`}
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
            animated={!progressView.reducedMotion}
            cinematic={progressView.displayMode === 'presentation'}
            fitForPrint={progressView.displayMode === 'print'}
            lifecycle={mapLifecycle}
            position={progressView.position}
            progress={progressView.progress}
            showLegend={progressView.displayMode !== 'presentation'}
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
          act={progressAction}
          presentationButtonRef={presentationButtonRef}
          view={progressView}
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
