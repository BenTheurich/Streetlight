import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRegionSetupWorkflow } from '../lib/region-setup-workflow.ts';
import { TerritoryEditor } from './TerritoryEditor.tsx';

test('a fresh church can save its default region without making an edit', async (t) => {
  const workspace = {
    id: 'new-region',
    churchName: 'Sample Church',
    name: 'Outreach Region',
    originAddress: '1 Sample Road',
    center: [-117.15, 33.5],
    radiusMiles: 1,
    boundaryShape: 'circle',
    import: {
      kind: 'overture',
      release: null,
      center: null,
      radiusMiles: null,
      completedAt: null,
      normalizerVersion: null,
      quality: null,
    },
    apartmentSites: [],
    apartmentComplexes: [],
    segments: [],
    totals: { allSegments: 0, eligibleSegments: 0, allHomes: 0, eligibleHomes: 0 },
  };
  const workflow = createRegionSetupWorkflow({
    initialSetup: true,
    onAccepted: async () => undefined,
    onLeaveReady: () => undefined,
    transport: {
      loadTerritory: async () => Response.json(workspace),
      observeImport: async () => Response.json({ job: null, workspace: null }),
      saveTerritory: async () => assert.fail('rendering must not start an import'),
    },
  });
  t.after(workflow.start());
  await new Promise((resolve) => setImmediate(resolve));
  const view = workflow.getSnapshot();
  assert.equal(view.kind, 'ready');
  assert.equal(view.dirty, false);
  assert.equal(view.canSave, true);
  const markup = renderToStaticMarkup(
    createElement(TerritoryEditor, {
      active: true,
      mapVisible: false,
      lifecycle: null,
      overlayRoot: null,
      mapsApiKey: '',
      onReturnToSetup() {},
      onStay() {},
      onViewChange() {},
      pendingLeave: false,
      view,
      workflow,
    }),
  );
  assert.match(markup, /<button(?![^>]*disabled)[^>]*>Save changes<\/button>/);
  assert.match(markup, /Saving will prepare the streets in your region/);
});
