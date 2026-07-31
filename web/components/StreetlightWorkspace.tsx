'use client';

import Image from 'next/image';
import { useCallback, useEffect, useState } from 'react';
import type { CoverageWorkspace, TerritoryWorkspace } from '@/lib/database';
import type { ReviewedPacketGenerationResult } from '@/lib/packet-finalization';
import { AdministratorAccount } from './AdministratorAccount';
import { AdminMap } from './AdminMap';
import { CoverageDashboard } from './CoverageDashboard';
import { CoverageMap } from './CoverageMap';
import { HeatmapSettingsOverlay } from './HeatmapSettingsOverlay';
import { MapLayersControl } from './MapLayersControl';
import { PacketGenerator } from './PacketGenerator';
import { PacketProposalMap } from './PacketProposalMap';
import { ReconciliationTool } from './ReconciliationTool';
import { TerritoryEditor } from './TerritoryEditor';

type WorkspaceTool = 'coverage' | 'packets' | 'reconciliation' | 'territory';

const tools: Array<{ id: WorkspaceTool; label: string; shortLabel: string }> = [
  { id: 'coverage', label: 'Coverage', shortLabel: 'Coverage' },
  { id: 'packets', label: 'Generate packets', shortLabel: 'Generate' },
  { id: 'reconciliation', label: 'Reconcile packets', shortLabel: 'Reconcile' },
  { id: 'territory', label: 'Territory setup', shortLabel: 'Territory' },
];

export function StreetlightWorkspace({
  administratorEmail,
  pendingPilotRequests,
  setupOnly = false,
  initialData,
  mapsApiKey,
}: {
  administratorEmail: string;
  pendingPilotRequests?: number | null;
  setupOnly?: boolean;
  initialData: CoverageWorkspace;
  mapsApiKey: string;
}) {
  const [setupRequired, setSetupOnly] = useState(setupOnly);
  const [tool, setTool] = useState<WorkspaceTool>(setupOnly ? 'territory' : 'coverage');
  const [coverage, setCoverage] = useState(initialData);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(
    initialData.segments.find((segment) => segment.eligible)?.id ??
      initialData.segments[0]?.id ??
      null,
  );
  const [packetResult, setPacketResult] = useState<ReviewedPacketGenerationResult | null>(null);
  const [selectedPacketIndex, setSelectedPacketIndex] = useState<number | null>(null);
  const [territory, setTerritory] = useState<TerritoryWorkspace | null>(null);
  const [territoryLoading, setTerritoryLoading] = useState(false);
  const [territoryError, setTerritoryError] = useState('');
  const [territoryDirty, setTerritoryDirty] = useState(false);
  const [territorySaving, setTerritorySaving] = useState(false);
  const [pendingTool, setPendingTool] = useState<WorkspaceTool | null>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [overlayRoot, setOverlayRoot] = useState<HTMLDivElement | null>(null);
  const [heatmapSettingsOpen, setHeatmapSettingsOpen] = useState(false);
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
    if (tool === 'territory' && !territory && !territoryLoading && !territoryError) {
      void loadTerritory();
    }
  }, [loadTerritory, territory, territoryError, territoryLoading, tool]);

  const selectCoverageSegment = useCallback((id: string) => {
    setSelectedSegmentId(id);
  }, []);

  const refreshCoverage = useCallback(async () => {
    const response = await fetch('/api/coverage');
    const result = (await response.json()) as CoverageWorkspace | { error: string };
    if (!response.ok || 'error' in result) {
      throw new Error('error' in result ? result.error : 'Could not refresh coverage');
    }
    setCoverage(result);
    setSelectedSegmentId((current) =>
      result.segments.some((segment) => segment.id === current)
        ? current
        : (result.segments.find((segment) => segment.eligible)?.id ??
          result.segments[0]?.id ??
          null),
    );
  }, []);

  const refreshAfterTerritorySave = useCallback(
    async (saved: TerritoryWorkspace) => {
      const completingSetup = setupRequired;
      setTerritory(saved);
      setPacketResult(null);
      setSelectedPacketIndex(null);
      await refreshCoverage();
      setSetupOnly(false);
      if (completingSetup) setTool('coverage');
    },
    [refreshCoverage, setupRequired],
  );

  function openTool(nextTool: WorkspaceTool): void {
    if (nextTool === tool) return;
    if (tool === 'territory' && territoryDirty && !territorySaving) {
      setPendingTool(nextTool);
      return;
    }
    setHeatmapSettingsOpen(false);
    setTool(nextTool);
  }

  function finishTerritoryLeave(): void {
    if (!pendingTool) return;
    setTool(pendingTool);
    setPendingTool(null);
  }

  return (
    <div className="territory-page">
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
          <AdminMap apiKey={mapsApiKey} churchCenter={coverage.center} onMapChange={setMap} />
          <MapLayersControl map={map} />
          <CoverageMap
            active={tool !== 'territory'}
            apartmentComplexes={coverage.apartmentComplexes}
            interactive={tool === 'coverage'}
            legend={coverage.legend}
            map={map}
            onEditHeatmapRanges={() => setHeatmapSettingsOpen(true)}
            onSelectSegment={selectCoverageSegment}
            segments={coverage.segments}
            selectedSegmentId={tool === 'coverage' ? selectedSegmentId : null}
          />
          <PacketProposalMap
            active={tool === 'packets'}
            map={map}
            proposals={packetResult?.proposals ?? []}
            selectedIndex={selectedPacketIndex}
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
          onOpenPackets={() => openTool('packets')}
          onOpenReconciliation={() => setTool('reconciliation')}
          onSelectSegment={setSelectedSegmentId}
          onWorkspaceChange={setCoverage}
          selectedSegmentId={selectedSegmentId}
          workspace={coverage}
        />
        <PacketGenerator
          active={tool === 'packets'}
          activePackets={coverage.activePackets}
          latestBatch={coverage.latestBatch}
          qualityWarnings={coverage.qualityWarnings}
          onFinalized={refreshCoverage}
          onResultChange={setPacketResult}
          onSelectedIndexChange={setSelectedPacketIndex}
          result={packetResult}
          selectedIndex={selectedPacketIndex}
        />
        <ReconciliationTool
          active={tool === 'reconciliation'}
          map={map}
          onChanged={refreshCoverage}
        />
        {territory && (
          <TerritoryEditor
            active={tool === 'territory'}
            initialData={territory}
            map={map}
            onDirtyChange={setTerritoryDirty}
            onDiscardAndLeave={finishTerritoryLeave}
            onImportingChange={setTerritorySaving}
            onReturnToSetup={() => setTool('territory')}
            onSaved={refreshAfterTerritorySave}
            onSaveAndLeave={finishTerritoryLeave}
            onStay={() => setPendingTool(null)}
            overlayRoot={overlayRoot}
            pendingLeave={pendingTool !== null}
            setupRequired={setupRequired}
          />
        )}
        {tool === 'territory' && !territory && (
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
