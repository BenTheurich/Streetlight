import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('packet page exposes only the approved read-only proposal workflow', () => {
  const generator = readFileSync(new URL('./PacketGenerator.tsx', import.meta.url), 'utf8');
  const coverage = readFileSync(new URL('./CoverageDashboard.tsx', import.meta.url), 'utf8');

  assert.match(generator, /Generate proposals/);
  assert.match(generator, /Add packet size/);
  assert.match(generator, /Starting address/);
  assert.match(generator, /\/api\/packet-proposals/);
  assert.doesNotMatch(generator, /Finalize|QR code|walking route|end point/i);
  assert.match(coverage, /href="\/packets"/);
});

test('packet map opens over the saved territory before a proposal exists', () => {
  const page = readFileSync(new URL('../app/packets/page.tsx', import.meta.url), 'utf8');
  const generator = readFileSync(new URL('./PacketGenerator.tsx', import.meta.url), 'utf8');
  const map = readFileSync(new URL('./PacketProposalMap.tsx', import.meta.url), 'utf8');

  assert.match(page, /getTerritoryWorkspace/);
  assert.match(generator, /<PacketProposalMap apiKey=\{mapsApiKey\} center=\{center\}/);
  assert.match(map, /center: latLng\(center\)/);
  assert.doesNotMatch(map, /center:\s*\{\s*lat:\s*0,\s*lng:\s*0\s*\}/);
});
