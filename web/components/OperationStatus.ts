import { createElement, type ReactNode } from 'react';

type OperationStatusTone = 'busy' | 'error' | 'success';
type OperationStatusPlacement = 'surface' | 'global';

export function OperationStatus({
  action,
  detail,
  headline,
  placement = 'surface',
  tone,
}: {
  action?: ReactNode;
  detail: string;
  headline: string;
  placement?: OperationStatusPlacement;
  tone: OperationStatusTone;
}) {
  const failed = tone === 'error';

  return createElement(
    'div',
    {
      'aria-atomic': true,
      'aria-busy': tone === 'busy' ? true : undefined,
      'aria-live': failed ? 'assertive' : 'polite',
      className: `operation-status ${placement} ${tone}`,
      role: failed ? 'alert' : 'status',
    },
    createElement('span', { 'aria-hidden': true, className: 'operation-status-cue' }),
    createElement(
      'div',
      { className: 'operation-status-copy' },
      createElement('strong', null, headline),
      createElement('span', null, detail),
    ),
    action ? createElement('div', { className: 'operation-status-action' }, action) : null,
  );
}
