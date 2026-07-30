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

test('coverage makes the current outreach continuation explicit without hiding other tools', () => {
  const source = readFileSync(new URL('./CoverageDashboard.tsx', import.meta.url), 'utf8');

  assert.match(source, />Current work</);
  assert.match(source, /onOpenPackets/);
  assert.match(source, /onOpenReconciliation/);
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

test('reconciliation leads with the physical paper question', () => {
  const source = readFileSync(new URL('./ReconciliationTool.tsx', import.meta.url), 'utf8');

  assert.match(source, /Which packet sheets are still here\?/);
});
