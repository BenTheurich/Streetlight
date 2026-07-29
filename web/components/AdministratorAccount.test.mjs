import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('the administrator account identifies the current user and exposes sign out', () => {
  const source = readFileSync(new URL('./AdministratorAccount.tsx', import.meta.url), 'utf8');

  assert.match(source, /\{email\}/);
  assert.match(source, /href="\/logout"/);
  assert.match(source, />Sign out</);
});
