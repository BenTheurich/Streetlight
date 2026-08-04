import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('new churches see only territory setup until the first save succeeds', () => {
  const source = readFileSync(new URL('./StreetlightWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(source, /setupOnly/);
  assert.match(source, /!setupRequired &&/);
  assert.match(source, /setSetupOnly\(false\)/);
});

test('the workspace uses one branded header without a duplicate current-tool label', () => {
  const source = readFileSync(new URL('./StreetlightWorkspace.tsx', import.meta.url), 'utf8');

  assert.match(source, /landing\/streetlight-logo-mark-v2\.webp/);
  assert.doesNotMatch(source, /phase-label/);
  assert.match(source, /aria-label="Administrator tools"/);
});

test('tool sidebars begin with task content instead of repeating the selected tool name', () => {
  for (const filename of [
    './CoverageDashboard.tsx',
    './PacketGenerator.tsx',
    './ReconciliationTool.tsx',
    './StreetlightWorkspace.tsx',
    './TerritoryEditor.tsx',
  ]) {
    const source = readFileSync(new URL(filename, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /sidebar-title/);
  }
});

test('coverage makes the current outreach continuation explicit without hiding other tools', () => {
  const source = readFileSync(new URL('./CoverageDashboard.tsx', import.meta.url), 'utf8');

  assert.match(source, />Current work</);
  assert.match(source, /onOpenPackets/);
  assert.match(source, /onOpenReconciliation/);
});

test('the four top-level tools keep packet and setup workflows together', () => {
  const source = readFileSync(new URL('./StreetlightWorkspace.tsx', import.meta.url), 'utf8');

  assert.match(source, /label: 'Packets'/);
  assert.match(source, /label: 'Outreach progress'/);
  assert.match(source, /label: 'Setup'/);
  assert.doesNotMatch(source, /id: 'reconciliation'/);
  assert.match(source, /setPacketView\('reconcile'\);\s*openTool\('packets'\)/);
  assert.match(source, /<PrintoutSettings/);
  assert.match(source, /<OutreachProgress/);
});

test('the shared coverage map expands apartment clusters and removes its click handler', () => {
  const source = readFileSync(new URL('./OpenCoverageMap.tsx', import.meta.url), 'utf8');

  assert.match(source, /expandApartmentCluster\(/);
  assert.match(source, /map\.on\('click', 'streetlight-apartment-clusters', expand\)/);
  assert.match(source, /map\.off\('click', 'streetlight-apartment-clusters', expand\)/);
});

test('map display and heatmap ranges are edited from the shared legend', () => {
  const workspace = readFileSync(new URL('./StreetlightWorkspace.tsx', import.meta.url), 'utf8');
  const map = readFileSync(new URL('./OpenCoverageMap.tsx', import.meta.url), 'utf8');
  const dashboard = readFileSync(new URL('./CoverageDashboard.tsx', import.meta.url), 'utf8');
  const settings = readFileSync(new URL('./HeatmapSettingsOverlay.tsx', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

  assert.match(map, /aria-label="Open map settings"/);
  assert.match(map, /<circle cx="12" cy="12" r="3"/);
  assert.match(workspace, /<HeatmapSettingsOverlay/);
  assert.doesNotMatch(dashboard, /Heatmap ranges/);
  assert.match(settings, /days since last outreach/);
  assert.doesNotMatch(settings, /Choose how long a street waits/);
  assert.match(workspace, /showApartmentMarkers={showApartmentMarkers}/);
  assert.match(workspace, /localStorage\.setItem\(apartmentMarkerPreferenceKey/);
  assert.match(settings, /className="heatmap-settings-backdrop"/);
  assert.match(settings, /Show apartment markers/);
  assert.match(settings, /role="switch"/);
  assert.match(settings, /aria-label="Dismiss map settings"/);
  assert.match(styles, /\.heatmap-settings-form input\[type="number"\]::-webkit-inner-spin-button/);
  assert.match(styles, /width: min\(100%, 390px\)/);
});

test('proposal rows expand and collapse inline without a separate show-all control', () => {
  const source = readFileSync(new URL('./PacketGenerator.tsx', import.meta.url), 'utf8');

  assert.match(source, /onSelectedIndexChange\(selected \? null : index\)/);
  assert.match(source, /aria-label={`Delete Packet \$\{index \+ 1\} proposal`}/);
  assert.match(source, /aria-label={`Remove packet size \$\{index \+ 1\}`}/);
  assert.doesNotMatch(source, />\s*Remove\s*</);
  assert.match(source, /function deleteProposal[\s\S]*onSelectedIndexChange\(null\)/);
  assert.doesNotMatch(source, /selectedIndex > index/);
  assert.match(source, /proposalIndexes: result\.proposalIndexes/);
  assert.doesNotMatch(source, />\s*Show all\s*</);
  assert.match(source, /!finalized && result\.proposals\.length > 0/);
});

test('packet finalization confirmation moves focus in and returns it on cancel', () => {
  const source = readFileSync(new URL('./PacketGenerator.tsx', import.meta.url), 'utf8');

  assert.match(source, /if \(confirming\) confirmFinalizationRef\.current\?\.focus\(\)/);
  assert.match(source, /finalizationTriggerRef\.current\?\.focus\(\)/);
  assert.match(source, /ref={confirmFinalizationRef}/);
  assert.match(source, /ref={finalizationTriggerRef}/);
});

test('one packet operation lock owns every mutation and PDF entry point', () => {
  const source = readFileSync(new URL('./PacketGenerator.tsx', import.meta.url), 'utf8');

  assert.match(source, /const packetOperationBusy = packetRequestControlsDisabled/);
  assert.equal(source.match(/disabled={packetOperationBusy}/g)?.length, 11);
  assert.match(source, /disabled={packetOperationBusy \|\| activePackets === 0}/);
  assert.equal(source.match(/if \(packetOperationBusy\) return;/g)?.length, 3);
});

test('territory church location reuses onboarding place search with a manual fallback', () => {
  const workspace = readFileSync(new URL('./StreetlightWorkspace.tsx', import.meta.url), 'utf8');
  const territory = readFileSync(new URL('./TerritoryEditor.tsx', import.meta.url), 'utf8');

  assert.match(territory, /PlaceAutocompleteElement/);
  assert.match(territory, /Search for your church or address/);
  assert.match(territory, /placeSearchFailed/);
  assert.match(workspace, /mapsApiKey={mapsApiKey}/);
});
test('territory selection and long imports stay in the approved workflow', () => {
  const source = readFileSync(new URL('./TerritoryEditor.tsx', import.meta.url), 'utf8');

  assert.doesNotMatch(source, />\s*Pan\s*</);
  assert.match(source, /placement={operationPlacement}/);
  assert.match(source, /Your saved region remains active/);
  assert.match(source, /!backgroundImportComplete/);
  assert.doesNotMatch(source, /territory-import-banner/);
});

test('territory verification keeps global tool navigation available without unmounting the draft', () => {
  const workspace = readFileSync(new URL('./StreetlightWorkspace.tsx', import.meta.url), 'utf8');
  const territory = readFileSync(new URL('./TerritoryEditor.tsx', import.meta.url), 'utf8');
  const printouts = readFileSync(new URL('./PrintoutSettings.tsx', import.meta.url), 'utf8');

  assert.match(territory, /onImportingChange\(leaveControlsDisabled\)/);
  assert.match(workspace, /territoryDirty && !territorySaving/);
  assert.match(workspace, /setupView === 'printouts' && printoutDirty/);
  assert.match(printouts, /Save printout changes before leaving\?/);
  assert.match(workspace, /\{territory && \(\s*<TerritoryEditor/);
});

test('workflow surfaces use one atomic operation status without duplicate live copy', () => {
  const packets = readFileSync(new URL('./PacketGenerator.tsx', import.meta.url), 'utf8');
  const reconciliation = readFileSync(new URL('./ReconciliationTool.tsx', import.meta.url), 'utf8');
  const territory = readFileSync(new URL('./TerritoryEditor.tsx', import.meta.url), 'utf8');

  assert.match(packets, /<OperationStatus/);
  assert.match(packets, /downloadProgress\.headline/);
  assert.doesNotMatch(packets, /<p aria-live="polite">{notice}<\/p>/);

  assert.match(reconciliation, /<OperationStatus/);
  assert.doesNotMatch(reconciliation, /<p aria-live="polite">{notice}<\/p>/);

  assert.match(territory, /<OperationStatus/);
  assert.doesNotMatch(territory, /territory-import-banner/);
});

test('territory editing keeps shared overlays and selects exact segments directly', () => {
  const source = readFileSync(new URL('./OpenTerritoryMap.tsx', import.meta.url), 'utf8');
  const editor = readFileSync(new URL('./TerritoryEditor.tsx', import.meta.url), 'utf8');

  assert.match(source, /getSource\('streetlightCoverage'\)/);
  assert.match(source, /selectedIds\.has\(segment\.id\)/);
  assert.match(source, /queryRenderedFeatures\(bounds/);
  assert.match(source, /event\.originalEvent\.shiftKey/);
  assert.match(source, /boxSelectionArmed/);
  assert.match(editor, /mutationLocked={leaveControlsDisabled}/);
  assert.match(editor, /setSegmentsExcluded/);
  assert.match(editor, /activateSegments/);
  assert.match(editor, /Shift-drag selects an area/);
  assert.doesNotMatch(source, /territory-exclusions|territory-drawing/);
  assert.doesNotMatch(editor, /Draw exclusion area|finishDrawing|selectedExclusionId/);
});

test('basemap changes republish the map after the replacement style has committed', () => {
  const source = readFileSync(new URL('./WorkspaceMap.tsx', import.meta.url), 'utf8');

  assert.match(source, /map\.once\('style\.load', republish\)/);
  assert.match(
    source,
    /republish = \(\) => \{\s*frame = requestAnimationFrame\(\(\) => onMapChangeRef\.current\(map\)\)/,
  );
  assert.match(source, /cancelAnimationFrame\(frame\)/);
});

test('reconciliation requires an explicit outcome for every physical sheet', () => {
  const source = readFileSync(new URL('./ReconciliationTool.tsx', import.meta.url), 'utf8');

  assert.match(source, /className="reconciliation-active-picker-heading"/);
  assert.doesNotMatch(source, /Choose one outcome for every packet sheet/);
  assert.match(source, /: 'Choose one outcome'}/);
  assert.match(source, /aria-pressed=\{outcome === value\}/);
  assert.match(source, /disabled=\{!reviewReady \|\| mutationControlsDisabled\}/);
});

test('reconciliation keeps pending outcomes visible and history compact', () => {
  const source = readFileSync(new URL('./ReconciliationTool.tsx', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

  assert.match(source, /All taken/);
  assert.match(source, /All discarded/);
  assert.match(source, /Cancels this packet and returns its streets for future generation/);
  assert.match(source, /className="reconciliation-outcome-summary"/);
  assert.match(source, /const editing = editingPacketId === packet\.id/);
  assert.match(source, /aria-expanded=\{editing\}/);
  assert.match(styles, /\.reconciliation-bulk-actions button \{[^}]*min-height: 44px;/s);
});

test('reconciliation identifies every batch with its saved name and finalized time', () => {
  const source = readFileSync(new URL('./ReconciliationTool.tsx', import.meta.url), 'utf8');

  assert.match(source, /function batchOptionLabel\(batch: ReconciliationBatch\)/);
  assert.match(source, /const automaticPrefix = 'Outreach batch - '/);
  assert.match(source, /dateStyle: 'medium'/);
  assert.match(source, /timeStyle: 'short'/);
  assert.match(source, /\? batchOptionLabel\(candidate\)/);
  assert.match(source, /: historyBatchOptionLabel\(candidate\)/);
});

test('reconciliation highlights the selected batch with the shared light-blue road halo', () => {
  const source = readFileSync(new URL('./OpenReconciliationOverlay.tsx', import.meta.url), 'utf8');

  assert.match(source, /'line-color': '#78a9ff'/);
  assert.match(source, /const haloBefore = map\.getLayer\('streetlight-coverage'\)/);
  assert.match(source, /'line-width': \['interpolate', \['linear'\], \['zoom'\], 11, 10, 14, 13\]/);
  assert.match(source, /const focusKey = `\$\{batch\.id\}:/);
});

test('reconciliation correction status and retry stay with the affected packet', () => {
  const source = readFileSync(new URL('./ReconciliationTool.tsx', import.meta.url), 'utf8');

  assert.match(source, /type CorrectionAttempt =/);
  assert.match(source, /attempt: \{ packetId: packet\.id, coveredOn \}/);
  assert.equal(source.match(/correctionStatus\(packet\)/g)?.length, 2);
  assert.match(source, /void correct\(packet, correctionFeedback\.attempt\.coveredOn\)/);
  assert.doesNotMatch(source, /operation === 'correction'/);
});
