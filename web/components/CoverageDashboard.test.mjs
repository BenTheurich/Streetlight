import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('current estimated progress omits empty bands and duplicate day labels', () => {
  const source = readFileSync(new URL('./CoverageDashboard.tsx', import.meta.url), 'utf8');

  assert.match(source, />Current estimated progress</);
  assert.match(source, /distributionItems\.filter\(\(item\) => item\.homes > 0\)/);
  assert.doesNotMatch(source, /item\.label(?![A-Za-z])/);
});

test('street search announces both matching and no-result states', () => {
  const source = readFileSync(new URL('./CoverageDashboard.tsx', import.meta.url), 'utf8');

  assert.match(source, /No streets match[^<]+<\/p>/);
  assert.equal(source.match(/className="coverage-search-status" role="status"/g)?.length, 2);
});
