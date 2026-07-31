import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('each coverage correction root visibly identifies its stable event ID', () => {
  const source = readFileSync(new URL('./CoverageDashboard.tsx', import.meta.url), 'utf8');

  assert.match(source, /<code className="coverage-event-id">Event ID: \{root\.eventId\}<\/code>/);
});

test('current estimated progress omits empty bands and duplicate day labels', () => {
  const source = readFileSync(new URL('./CoverageDashboard.tsx', import.meta.url), 'utf8');

  assert.match(source, />Current estimated progress</);
  assert.match(source, /distributionItems\.filter\(\(item\) => item\.homes > 0\)/);
  assert.doesNotMatch(source, /item\.label(?![A-Za-z])/);
});
