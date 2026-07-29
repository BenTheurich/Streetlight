import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('the administrator account opens a native menu with identity and sign out', () => {
  const source = readFileSync(new URL('./AdministratorAccount.tsx', import.meta.url), 'utf8');

  assert.match(source, /popoverTarget="administrator-account-menu"/);
  assert.match(source, /popover="auto"/);
  assert.match(source, /aria-haspopup="menu"/);
  assert.match(source, /role="menu"/);
  assert.match(source, /\{email\}/);
  assert.match(source, /href="\/logout"/);
  assert.match(source, />\s*Sign out\s*</);
  assert.match(source, /href="\/pilot-requests"/);
  assert.match(source, /pendingPilotRequests/);
});
