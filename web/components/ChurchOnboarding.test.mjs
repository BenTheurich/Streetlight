import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('onboarding offers Google place search and a constrained time-zone choice', () => {
  const source = readFileSync(new URL('./ChurchOnboarding.tsx', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  const selectSource = readFileSync(new URL('./StreetlightSelect.tsx', import.meta.url), 'utf8');

  assert.match(source, /PlaceAutocompleteElement/);
  assert.match(source, /Search for your church or address/);
  assert.match(source, /name="address"/);
  assert.match(source, /StreetlightSelect[\s\S]*name="timeZone"/);
  assert.match(selectSource, /@radix-ui\/react-select/);
  assert.match(page, /Intl\.supportedValuesOf\('timeZone'\)/);
  assert.match(styles, /\.church-onboarding button\.streetlight-select-trigger/s);
  assert.doesNotMatch(source, /No street data is imported/);
});
