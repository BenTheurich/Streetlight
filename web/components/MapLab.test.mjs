import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('map lab mounts only selected engines and keeps diagnostics in component memory', () => {
  const source = readFileSync(new URL('./MapLab.tsx', import.meta.url), 'utf8');
  const style = readFileSync(new URL('../lib/open-map-style.ts', import.meta.url), 'utf8');

  assert.match(source, /mode === 'open' \|\| mode === 'compare'/);
  assert.match(source, /mode === 'google' \|\| mode === 'compare'/);
  assert.match(source, /fetch\('\/api\/founder\/map-lab'/);
  assert.match(style, /satellite\/\{z\}\/\{x\}\/\{y\}/);
  assert.match(source, /useState<PaneDiagnostics>/);
  assert.doesNotMatch(source, /setLayoutProperty\('satellite', 'visibility', 'none'\)/);
  assert.match(source, /setLayoutProperty\('satellite', 'visibility', 'visible'\)/);
  assert.match(source, /key=\{`open-\$\{openKey\}`\}/);
  assert.match(source, /key=\{`google-\$\{googleKey\}`\}/);
  assert.doesNotMatch(source, /FEMA gap audit/);
  assert.doesNotMatch(source, /high-confidence row gaps/);
  assert.doesNotMatch(source, /unresolved candidates/);
  assert.doesNotMatch(source, /without Overture address/);
  assert.doesNotMatch(source, /Audit only — not counted/);
  assert.doesNotMatch(source, /method:\s*['"](POST|PUT|PATCH|DELETE)/);
});
