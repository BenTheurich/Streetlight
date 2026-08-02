import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('the public landing retains the approved pilot drawer and administrator login', () => {
  const source = readFileSync(new URL('./PublicLanding.tsx', import.meta.url), 'utf8');
  const script = readFileSync(
    new URL('../public/landing/spread-the-light-v2.js', import.meta.url),
    'utf8',
  );

  assert.match(source, /from 'next\/script'/);
  assert.match(source, /strategy="afterInteractive"/);
  assert.doesNotMatch(source, /<script src="\/landing\/spread-the-light-v2\.js"/);
  assert.match(source, /Carry the light/);
  assert.match(source, /Ye are the light of the world\./);
  assert.match(source, /Matthew 5:14/);
  assert.ok(source.indexOf('Bring forgotten streets') < source.indexOf('Ye are the light'));
  assert.ok(source.indexOf('Ye are the light') < source.indexOf('Turn need into'));
  assert.match(script, /Math\.min\(5, Math\.floor\(clamp\(progress\) \* 6\)\)/);
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
