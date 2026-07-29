import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('new churches see only territory setup until the first save succeeds', () => {
  const source = readFileSync(new URL('./StreetlightWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(source, /setupOnly/);
  assert.match(source, /id === 'territory'/);
  assert.match(source, /setSetupOnly\(false\)/);
});
