import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('onboarding offers Google place search and a constrained time-zone choice', () => {
  const source = readFileSync(new URL('./ChurchOnboarding.tsx', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

  assert.match(source, /PlaceAutocompleteElement/);
  assert.match(source, /Search for your church or address/);
  assert.match(source, /name="address"/);
  assert.match(source, /<select[\s\S]*name="timeZone"/);
  assert.match(page, /Intl\.supportedValuesOf\('timeZone'\)/);
  assert.match(
    styles,
    /\.church-onboarding option\s*{[^}]*color:\s*#0b1727;[^}]*background:\s*#f7f2e8;/s,
  );
  assert.doesNotMatch(source, /No street data is imported/);
});
