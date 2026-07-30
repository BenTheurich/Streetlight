import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('the public landing retains the approved pilot drawer and administrator login', () => {
  const source = readFileSync(new URL('./PublicLanding.tsx', import.meta.url), 'utf8');

  assert.match(source, /from 'next\/script'/);
  assert.match(source, /strategy="afterInteractive"/);
  assert.doesNotMatch(source, /<script src="\/landing\/spread-the-light-v2\.js"/);
  assert.match(source, /Carry the light/);
  assert.match(source, /href="\/login"/);
  assert.match(source, /data-pilot-open/);
  assert.match(source, /name="churchName"/);
  assert.match(source, /name="contactName"/);
  assert.match(source, /name="email"/);
  assert.match(source, /name="location"/);
  assert.match(source, /name="outreachProcess"/);
  assert.match(source, /name="website"/);
  assert.match(source, /Request pilot access/);
});
