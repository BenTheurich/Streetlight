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
  assert.doesNotMatch(source, /method:\s*['"](POST|PUT|PATCH|DELETE)/);
});
