'use client';

import Image from 'next/image';
import { useCallback, useEffect, useState } from 'react';
import type { CoverageWorkspace, TerritoryWorkspace } from '@/lib/database';
import type { PacketGenerationResult } from '@/lib/packet-selection';
import { AdminMap } from './AdminMap';
import { CoverageDashboard } from './CoverageDashboard';
import { CoverageMap } from './CoverageMap';
import { PacketGenerator } from './PacketGenerator';
import { PacketProposalMap } from './PacketProposalMap';
import { TerritoryEditor } from './TerritoryEditor';

type WorkspaceTool = 'coverage' | 'packets' | 'territory';

const tools: Array<{ id: WorkspaceTool; label: string }> = [
  { id: 'coverage', label: 'Coverage' },
  { id: 'packets', label: 'Generate packets' },
  { id: 'territory', label: 'Territory setup' },
];

export function StreetlightWorkspace({
  initialData,
  mapsApiKey,
}: {
  initialData: CoverageWorkspace;
  mapsApiKey: string;
}) {
  const [tool, setTool] = useState<WorkspaceTool>('coverage');
  const [coverage, setCoverage] = useState(initialData);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(
    initialData.segments.find((segment) => segment.eligible)?.id ??
      initialData.segments[0]?.id ??
      null,
  );
  const [packetResult, setPacketResult] = useState<PacketGenerationResult | null>(null);
  const [selectedPacketIndex, setSelectedPacketIndex] = useState<number | null>(null);
  const [territory, setTerritory] = useState<TerritoryWorkspace | null>(null);
  const [territoryLoading, setTerritoryLoading] = useState(false);
  const [territoryError, setTerritoryError] = useState('');
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [overlayRoot, setOverlayRoot] = useState<HTMLDivElement | null>(null);

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

  const refreshAfterTerritorySave = useCallback(async (saved: TerritoryWorkspace) => {
    setTerritory(saved);
    setPacketResult(null);
    setSelectedPacketIndex(null);
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

  return (
    <div className="territory-page">
      <header className="territory-header workspace-header">
        <div className="brand">
          <Image alt="" height="32" src="/StreetlightLogo.png" width="32" />
          <span className="wordmark">Streetlight</span>
          <span className="phase-label">{tools.find(({ id }) => id === tool)?.label}</span>
          {coverage.dataMode === 'demo' && <span className="demo-data-label">Demo data</span>}
        </div>
        <nav aria-label="Administrator tools" className="workspace-tools">
          {tools.map(({ id, label }) => (
            <button
              aria-pressed={tool === id}
              className={tool === id ? 'active' : ''}
              key={id}
              onClick={() => setTool(id)}
              type="button"
            >
              {label}
            </button>
          ))}
        </nav>
      </header>
      <main className="territory-workspace">
        <section className="map-panel">
          <AdminMap apiKey={mapsApiKey} churchCenter={coverage.center} onMapChange={setMap} />
          <CoverageMap
            active={tool !== 'territory'}
            interactive={tool === 'coverage'}
            legend={coverage.legend}
            map={map}
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
          <div className="map-overlay-root" ref={setOverlayRoot} />
        </section>
        <CoverageDashboard
          active={tool === 'coverage'}
          onSelectSegment={setSelectedSegmentId}
          onWorkspaceChange={setCoverage}
          selectedSegmentId={selectedSegmentId}
          workspace={coverage}
        />
        <PacketGenerator
          active={tool === 'packets'}
          onResultChange={setPacketResult}
          onSelectedIndexChange={setSelectedPacketIndex}
          result={packetResult}
          selectedIndex={selectedPacketIndex}
        />
        {territory && (
          <TerritoryEditor
            active={tool === 'territory'}
            initialData={territory}
            map={map}
            onSaved={refreshAfterTerritorySave}
            overlayRoot={overlayRoot}
          />
        )}
        {tool === 'territory' && !territory && (
          <aside className="territory-sidebar">
            <div className="sidebar-title">
              <h1>Territory Setup</h1>
              <p>
                {territoryLoading ? 'Loading saved territory…' : 'Saved territory unavailable.'}
              </p>
            </div>
            {territoryError && (
              <div className="sidebar-scroll">
                <p className="field-error" role="alert">
                  {territoryError}
                </p>
                <button
                  onClick={() => {
                    setTerritoryError('');
                    void loadTerritory();
                  }}
                  type="button"
                >
                  Retry
                </button>
              </div>
            )}
          </aside>
        )}
      </main>
    </div>
  );
}
