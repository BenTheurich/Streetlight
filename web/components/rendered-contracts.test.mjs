import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdministratorAccount } from './AdministratorAccount.tsx';
import { ChurchOnboarding } from './ChurchOnboarding.tsx';
import { CoverageDashboard } from './CoverageDashboard.tsx';
import { OutreachProgress } from './OutreachProgress.tsx';
import { PublicLanding } from './PublicLanding.tsx';

let browser;

test.before(async () => {
  browser = await chromium.launch({ headless: true });
});

test.after(async () => {
  await browser.close();
});

async function render(component) {
  const page = await browser.newPage();
  await page.setContent(
    `<!doctype html><html><body>${renderToStaticMarkup(component)}</body></html>`,
  );
  return page;
}

test('the administrator account renders an operable identity menu with pilot and sign-out links', async (t) => {
  const page = await render(
    createElement(AdministratorAccount, {
      email: 'admin@example.com',
      pendingPilotRequests: 2,
    }),
  );
  t.after(() => page.close());

  await page.getByRole('button', { name: /admin@example\.com/ }).click();
  assert.equal(
    await page
      .locator('#administrator-account-menu')
      .evaluate((menu) => menu.matches(':popover-open')),
    true,
  );
  assert.equal(
    await page.getByRole('menuitem', { name: /Pilot requests/ }).getAttribute('href'),
    '/pilot-requests',
  );
  assert.equal(
    await page.getByRole('menuitem', { name: 'Sign out' }).getAttribute('href'),
    '/logout',
  );
});

test('onboarding renders address search, a named time-zone choice, and sign out', async (t) => {
  const page = await render(
    createElement(ChurchOnboarding, {
      churchName: 'Sample Church',
      initialTimeZone: 'America/Los_Angeles',
      mapsApiKey: '',
      timeZones: ['America/Los_Angeles', 'America/New_York'],
    }),
  );
  t.after(() => page.close());

  await page.getByPlaceholder('Search for your church or address').waitFor();
  assert.equal(await page.locator('input[name="address"][type="hidden"]').count(), 1);
  assert.equal(
    await page.getByRole('combobox', { name: 'Time zone' }).getAttribute('id'),
    'church-time-zone',
  );
  assert.equal(await page.locator('select[name="timeZone"]').count(), 1);
  assert.equal(await page.getByRole('link', { name: 'Sign out' }).getAttribute('href'), '/logout');
});

test('current progress omits zero-home coverage bands from rendered semantics', async (t) => {
  const page = await render(
    createElement(CoverageDashboard, {
      active: true,
      workspace: {
        id: 'territory-1',
        churchName: 'Sample Church',
        name: 'Main region',
        center: [-117.14, 33.54],
        asOf: '2026-07-29',
        activePackets: 0,
        latestBatch: null,
        thresholds: { yellowAfterDays: 90, orangeAfterDays: 180, redAfterDays: 365 },
        legend: [],
        dataMode: 'canonical',
        qualityWarnings: [],
        apartmentComplexes: [],
        segments: [
          {
            id: 'green-segment',
            roadGroupId: 'green-road',
            streetName: 'Oak Street',
            geometry: {
              coordinates: [
                [-117.14, 33.54],
                [-117.13, 33.55],
              ],
            },
            estimatedHomes: 8,
            eligible: true,
            excludedReason: null,
            lastCoveredOn: '2026-07-28',
            coverageClass: 'green',
            roots: [],
          },
        ],
        totals: { eligibleHomes: 8 },
      },
      selectedSegmentId: null,
      onSelectSegment() {},
      onOpenPackets() {},
      onOpenReconciliation() {},
      onOpenHistory() {},
    }),
  );
  t.after(() => page.close());

  assert.equal(await page.getByRole('img').getAttribute('aria-label'), 'green: 8 estimated homes');
  assert.equal(await page.locator('.coverage-distribution-segment').count(), 1);
});

test('empty outreach years cannot be presented or printed', async (t) => {
  const page = await render(
    createElement(OutreachProgress, {
      active: true,
      churchName: 'Sample Church',
      act: async () => {},
      presentationButtonRef: { current: null },
      view: {
        displayMode: 'admin',
        error: '',
        reducedMotion: false,
        playing: false,
        progress: {
          dates: [],
          endDate: '2026-08-25',
          events: [],
          mode: 'calendar',
          startDate: '2026-01-01',
          units: [],
          year: 2026,
        },
        position: 0,
        selectedDate: null,
        snapshot: {
          apartmentComplexes: 0,
          completedPackets: 0,
          estimatedHomes: 0,
          outreachDays: 0,
          streets: 0,
        },
        timelinePosition: 0,
        year: 2026,
        years: [2026],
      },
    }),
  );
  t.after(() => page.close());

  await page.getByText('No completed outreach is recorded for this period.').waitFor();
  for (const name of ['Present full screen', 'Print progress']) {
    assert.equal(await page.getByRole('button', { name }).isDisabled(), true);
  }
  assert.equal(await page.getByRole('button', { name: /playback|Play 2026/ }).count(), 0);
  assert.equal(await page.getByRole('slider').count(), 0);
});

test('outreach playback groups transport controls and keeps output actions in task order', async (t) => {
  const page = await render(
    createElement(OutreachProgress, {
      active: true,
      churchName: 'Sample Church',
      act: async () => {},
      presentationButtonRef: { current: null },
      view: {
        displayMode: 'admin',
        error: '',
        reducedMotion: false,
        playing: false,
        progress: {
          dates: ['2025-10-02'],
          endDate: '2025-10-02',
          events: [{ date: '2025-10-02', packetId: 'packet-1' }],
          mode: 'rolling',
          startDate: '2024-10-04',
          units: [],
          year: 2025,
        },
        position: 0,
        selectedDate: null,
        snapshot: {
          apartmentComplexes: 0,
          completedPackets: 0,
          estimatedHomes: 0,
          outreachDays: 0,
          streets: 0,
        },
        timelinePosition: 0,
        year: 2025,
        years: [2025],
      },
    }),
  );
  t.after(() => page.close());

  await page.getByRole('heading', { name: 'Past year', exact: true }).waitFor();
  const playbackControls = page.locator('.progress-playback-controls');
  assert.equal(await playbackControls.getByRole('button', { name: 'Play past year' }).count(), 1);
  assert.equal(await playbackControls.getByRole('slider').count(), 1);
  assert.equal(await page.getByRole('button', { name: 'Restart' }).count(), 0);
  assert.deepEqual(await page.locator('.progress-actions button').allTextContents(), [
    'Present full screen',
    'Print progress',
  ]);
});

test('the public landing renders administrator login and the complete pilot request form', async (t) => {
  const page = await render(createElement(PublicLanding));
  t.after(() => page.close());

  assert.equal(
    await page.getByRole('link', { name: 'Admin login' }).first().getAttribute('href'),
    '/login',
  );
  assert.ok((await page.getByRole('button', { name: 'Request pilot access' }).count()) >= 1);
  for (const name of ['churchName', 'contactName', 'email', 'location', 'outreachProcess']) {
    assert.equal(await page.locator(`[name="${name}"]`).count(), 1);
  }
  const honeypot = page.locator('input[name="website"]');
  assert.equal(await honeypot.getAttribute('tabindex'), '-1');
  assert.equal(await honeypot.locator('xpath=..').getAttribute('aria-hidden'), 'true');
});
