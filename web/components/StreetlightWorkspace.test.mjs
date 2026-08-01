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

test('heatmap ranges are edited from the shared map legend instead of the coverage sidebar', () => {
  const workspace = readFileSync(new URL('./StreetlightWorkspace.tsx', import.meta.url), 'utf8');
  const map = readFileSync(new URL('./OpenCoverageMap.tsx', import.meta.url), 'utf8');
  const dashboard = readFileSync(new URL('./CoverageDashboard.tsx', import.meta.url), 'utf8');
  const settings = readFileSync(new URL('./HeatmapSettingsOverlay.tsx', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

  assert.match(map, /aria-label="Edit heatmap ranges"/);
  assert.match(map, /<circle cx="12" cy="12" r="3"/);
  assert.match(workspace, /<HeatmapSettingsOverlay/);
  assert.doesNotMatch(dashboard, /Heatmap ranges/);
  assert.match(settings, /days since last outreach/);
  assert.doesNotMatch(settings, /Choose how long a street waits/);
  assert.match(settings, /className="heatmap-settings-backdrop"/);
  assert.match(settings, /aria-label="Dismiss heatmap settings"/);
  assert.match(styles, /\.heatmap-settings-form input::-webkit-inner-spin-button/);
  assert.match(styles, /width: min\(100%, 390px\)/);
  assert.match(styles, /:focus-visible[\s\S]*?outline: 2px solid var\(--ink\)/);
  assert.doesNotMatch(styles, /:focus-visible[\s\S]{0,150}#(?:5e8eff|1769ff)/);
});

test('proposal rows expand and collapse inline without a separate show-all control', () => {
  const source = readFileSync(new URL('./PacketGenerator.tsx', import.meta.url), 'utf8');

  assert.match(source, /onSelectedIndexChange\(selected \? null : index\)/);
  assert.doesNotMatch(source, />\s*Show all\s*</);
  assert.match(source, /!finalized && result\.proposals\.length > 0/);
});

test('territory drawing and long imports stay in the approved workflow', () => {
  const source = readFileSync(new URL('./TerritoryEditor.tsx', import.meta.url), 'utf8');

  assert.doesNotMatch(source, />\s*Pan\s*</);
  assert.match(source, /territory-import-banner/);
});

test('territory editing keeps shared street overlays visible and redraws while vertices move', () => {
  const source = readFileSync(new URL('./OpenTerritoryMap.tsx', import.meta.url), 'utf8');

  assert.match(source, /getSource\('streetlightCoverage'\)/);
  assert.match(source, /setLayoutProperty\('streetlight-coverage', 'visibility', 'visible'\)/);
  assert.match(source, /marker\.on\('drag', updateVertex\)/);
  assert.match(source, /midpointMarker\.on\('drag', updateMidpoint\)/);
  assert.match(source, /type: 'LineString' as const, coordinates: drawingPoints/);
});

test('reconciliation leads with the physical paper question', () => {
  const source = readFileSync(new URL('./ReconciliationTool.tsx', import.meta.url), 'utf8');

  assert.match(source, /Which packet sheets are still here\?/);
});
