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
  const cue =
    tone === 'success'
      ? createElement(
          'svg',
          {
            'aria-hidden': true,
            className: 'operation-status-cue operation-status-success-icon',
            fill: 'none',
            stroke: 'currentColor',
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            strokeWidth: 2,
            viewBox: '0 0 24 24',
          },
          createElement('circle', { cx: 12, cy: 12, r: 9 }),
          createElement('path', { d: 'm8 12 2.5 2.5L16 9' }),
        )
      : createElement('span', { 'aria-hidden': true, className: 'operation-status-cue' });

  return createElement(
    'div',
    {
      'aria-atomic': true,
      'aria-busy': tone === 'busy' ? true : undefined,
      'aria-live': failed ? 'assertive' : 'polite',
      className: `operation-status ${placement} ${tone}`,
      role: failed ? 'alert' : 'status',
    },
    cue,
    createElement(
      'div',
      { className: 'operation-status-copy' },
      createElement('strong', null, headline),
      createElement('span', null, detail),
    ),
    action ? createElement('div', { className: 'operation-status-action' }, action) : null,
  );
}
