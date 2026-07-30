import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('map lab page redirects signed-out users and hides itself from non-founders', () => {
  const source = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');

  assert.match(source, /error instanceof SignInRequiredError/);
  assert.match(source, /redirect\('\/login'\)/);
  assert.match(source, /isFounderEmail\(session\.user\.email\)/);
  assert.match(source, /notFound\(\)/);
});
