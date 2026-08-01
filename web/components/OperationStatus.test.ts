import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OperationStatus } from './OperationStatus.ts';

test('busy operation status announces the complete task without taking focus', () => {
  const markup = renderToStaticMarkup(
    createElement(OperationStatus, {
      detail: 'The previous territory stays active while this finishes.',
      headline: 'Importing street data',
      tone: 'busy',
    }),
  );

  assert.match(markup, /class="operation-status surface busy"/);
  assert.match(markup, /role="status"/);
  assert.match(markup, /aria-live="polite"/);
  assert.match(markup, /aria-atomic="true"/);
  assert.match(markup, /aria-busy="true"/);
  assert.match(markup, />Importing street data</);
  assert.doesNotMatch(markup, /tabindex/);
});

test('failed operation status becomes an alert and keeps its recovery action', () => {
  const markup = renderToStaticMarkup(
    createElement(OperationStatus, {
      action: createElement('button', { type: 'button' }, 'Try again'),
      detail: 'Your previous saved territory is still active.',
      headline: 'Street import did not finish',
      placement: 'global',
      tone: 'error',
    }),
  );

  assert.match(markup, /class="operation-status global error"/);
  assert.match(markup, /role="alert"/);
  assert.match(markup, /aria-live="assertive"/);
  assert.doesNotMatch(markup, /aria-busy/);
  assert.match(markup, />Try again</);
});

test('completed operation status uses the same polite status contract', () => {
  const markup = renderToStaticMarkup(
    createElement(OperationStatus, {
      detail: 'Five packet sheets are ready.',
      headline: 'Packet PDF prepared',
      tone: 'success',
    }),
  );

  assert.match(markup, /class="operation-status surface success"/);
  assert.match(markup, /role="status"/);
  assert.match(markup, /aria-live="polite"/);
  assert.doesNotMatch(markup, /aria-busy/);
});
