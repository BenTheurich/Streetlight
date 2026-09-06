import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import '../test/public-release.mjs';
import { AdministratorAccount } from './AdministratorAccount.tsx';
import { ChurchOnboarding } from './ChurchOnboarding.tsx';
import { CoverageDashboard } from './CoverageDashboard.tsx';
import { OutreachProgress } from './OutreachProgress.tsx';

const { default: HowItWorksPage } = await import('../app/how-it-works/page.tsx');
const { default: PricingPage } = await import('../app/pricing/page.tsx');
const { default: WhyStreetlightPage } = await import('../app/why-streetlight/page.tsx');
const { PublicLanding } = await import('./PublicLanding.tsx');

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

const publicLandingMotion = readFileSync(
  new URL('../public/landing/spread-the-light-v2.js', import.meta.url),
  'utf8',
);
const publicLandingStyles = readFileSync(
  new URL('../public/landing/spread-the-light-v2.css', import.meta.url),
  'utf8',
);

async function scrollElementToViewportRatio(page, selector, ratio) {
  const top = await page
    .locator(selector)
    .evaluate((element) => element.getBoundingClientRect().top + window.scrollY);
  await page.evaluate(
    ([revealTop, viewportRatio]) => {
      window.scrollTo({
        top: revealTop - window.innerHeight * viewportRatio,
        behavior: 'instant',
      });
    },
    [top, ratio],
  );
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }),
  );
}

function clipInsetPercent(value) {
  return Number(value.match(/([\d.]+)%/)?.[1] ?? 0);
}

function circleRadiusPercent(value) {
  return Number(value.match(/circle\(([\d.]+)%/)?.[1] ?? 0);
}

test('compact and reduced-motion layouts defer desktop artwork and restore it on desktop', async (t) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  t.after(() => page.close());
  const requests = [];
  await page.route('https://streetlight.test/**', (route) => {
    requests.push(new URL(route.request().url()).pathname);
    return route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
    });
  });
  await page.setContent(`
    <base href="https://streetlight.test/">
    <style>${publicLandingStyles}</style>
    ${renderToStaticMarkup(createElement(PublicLanding))}
  `);
  const desktopSources = () =>
    page
      .locator('.anchor-stage img')
      .evaluateAll((images) => images.map((image) => image.currentSrc));
  assert.ok((await desktopSources()).every((source) => source.startsWith('data:')));
  assert.ok(!requests.includes('/landing/streetlamp-v2.webp'));
  assert.ok(!requests.includes('/landing/neighborhood-map-frosted-v2.webp'));

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  assert.ok((await desktopSources()).every((source) => source.startsWith('data:')));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.anchor-stage img')].every((image) =>
      image.currentSrc.startsWith('https://streetlight.test/landing/'),
    ),
  );
  assert.ok(requests.includes('/landing/streetlamp-v2.webp'));
  assert.ok(requests.includes('/landing/neighborhood-map-frosted-v2.webp'));

  await page.addScriptTag({ content: publicLandingMotion });
  await page.evaluate(() => {
    const story = document.querySelector('.anchor-story');
    window.scrollTo({ top: (story.offsetHeight - window.innerHeight) * 0.75, behavior: 'instant' });
  });
  await page.waitForFunction(
    () =>
      document.querySelector('.anchor-story').dataset.active === '3' &&
      Number(document.querySelector('.anchor-map').style.opacity) > 0.9,
  );
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForFunction(
    () =>
      document.querySelector('.anchor-story').dataset.active === '0' &&
      Number(document.querySelector('.anchor-map').style.opacity) === 0,
  );
});

test('the two lower landing-page sequences scrub backward and forward without CSS scroll timelines', async (t) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  t.after(() => page.close());
  await page.setContent(`
    <style>
      ${publicLandingStyles}
      [data-reveal], [data-reveal] * { animation: none !important; }
    </style>
    <main>
      <section class="anchor-story" style="height: 800px">
        <div class="anchor-lamp"><span class="lamp-lit"></span></div>
        <div class="anchor-aura"></div>
        <div class="anchor-daylight"></div>
        <div class="anchor-map"></div>
        <div class="anchor-paper"></div>
        <div class="anchor-step" data-step="0"></div>
      </section>
      <div style="height: 800px"></div>
      <div class="proof-composition">
        <figure class="coverage-proof" data-reveal="coverage"></figure>
        <figure class="packet-proof" data-reveal="packet"></figure>
      </div>
      <ol class="workflow" data-reveal="workflow" style="height: 180px">
        <li>Coverage</li>
        <li>Generate</li>
        <li>Print</li>
        <li>Reconcile</li>
      </ol>
      <div style="height: 1000px"></div>
      <figure class="outreach-progress-proof" data-reveal="progress" style="height: 560px">
        <div class="progress-projector">
          <span class="projector-glow"></span>
          <span class="projector-housing"></span>
          <div class="projector-screen" style="height: 260px"></div>
          <span class="projector-rail"></span>
          <span class="projector-pull"></span>
        </div>
        <figcaption><strong>Outreach Progress</strong></figcaption>
      </figure>
      <div style="height: 1000px"></div>
    </main>
    <dialog id="pilot-dialog" aria-labelledby="pilot-dialog-title">
      <h2 id="pilot-dialog-title" tabindex="-1">Request access</h2>
      <form class="drawer-form"><button type="submit">Submit</button></form>
      <div class="drawer-success" hidden><button data-pilot-close type="button">Close</button></div>
      <p class="drawer-error" hidden></p>
      <p data-pilot-message></p>
    </dialog>
  `);
  await page.addScriptTag({ content: publicLandingMotion });

  await scrollElementToViewportRatio(page, '.proof-composition', 0.72);
  const coverageReveal = circleRadiusPercent(
    await page.locator('.coverage-proof').evaluate((map) => getComputedStyle(map).clipPath),
  );
  assert.ok(coverageReveal > 10 && coverageReveal < 95, coverageReveal);
  await scrollElementToViewportRatio(page, '.proof-composition', 0.12);
  const coverageOpen = circleRadiusPercent(
    await page.locator('.coverage-proof').evaluate((map) => getComputedStyle(map).clipPath),
  );
  assert.ok(coverageOpen > 99, coverageOpen);

  await scrollElementToViewportRatio(page, '[data-reveal="workflow"]', 0.4);
  await page.waitForFunction(
    () => Number(getComputedStyle(document.querySelector('.workflow li')).opacity) > 0.99,
  );
  await scrollElementToViewportRatio(page, '[data-reveal="workflow"]', 0.87);
  const workflowReverse = Number(
    await page
      .locator('.workflow li')
      .first()
      .evaluate((item) => getComputedStyle(item).opacity),
  );
  assert.ok(workflowReverse > 0.05 && workflowReverse < 0.95, workflowReverse);

  await scrollElementToViewportRatio(page, '[data-reveal="workflow"]', 0.95);
  await scrollElementToViewportRatio(page, '[data-reveal="workflow"]', 0.87);
  const workflowForward = Number(
    await page
      .locator('.workflow li')
      .first()
      .evaluate((item) => getComputedStyle(item).opacity),
  );
  assert.ok(Math.abs(workflowReverse - workflowForward) < 0.02);

  await scrollElementToViewportRatio(page, '[data-reveal="progress"]', 0.35);
  const projectorMidway = clipInsetPercent(
    await page.locator('.projector-screen').evaluate((screen) => getComputedStyle(screen).clipPath),
  );
  assert.ok(projectorMidway > 20 && projectorMidway < 70, projectorMidway);
  const projectorRailMidway = await page
    .locator('.projector-rail')
    .evaluate((rail) => new DOMMatrix(getComputedStyle(rail).transform).m42);
  assert.ok(projectorRailMidway < -20, projectorRailMidway);
  await scrollElementToViewportRatio(page, '[data-reveal="progress"]', 0.05);
  const projectorOpen = clipInsetPercent(
    await page.locator('.projector-screen').evaluate((screen) => getComputedStyle(screen).clipPath),
  );
  assert.ok(projectorOpen < 5, projectorOpen);
  await scrollElementToViewportRatio(page, '[data-reveal="progress"]', 0.7);
  const projectorReverse = clipInsetPercent(
    await page.locator('.projector-screen').evaluate((screen) => getComputedStyle(screen).clipPath),
  );
  assert.ok(projectorReverse > 5 && projectorReverse < 95, projectorReverse);

  await scrollElementToViewportRatio(page, '[data-reveal="progress"]', 0.95);
  await scrollElementToViewportRatio(page, '[data-reveal="progress"]', 0.7);
  const projectorForward = clipInsetPercent(
    await page.locator('.projector-screen').evaluate((screen) => getComputedStyle(screen).clipPath),
  );
  assert.ok(Math.abs(projectorReverse - projectorForward) < 2);
});

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

test('the public landing renders shared navigation, access language, and the complete request form', async (t) => {
  const page = await render(createElement(PublicLanding));
  t.after(() => page.close());

  assert.equal(
    await page.getByRole('link', { name: 'Admin login' }).first().getAttribute('href'),
    '/login',
  );
  assert.ok((await page.getByRole('button', { name: 'Request access' }).count()) >= 1);
  for (const [name, href] of [
    ['How it works', '/how-it-works'],
    ['Why Streetlight', '/why-streetlight'],
    ['Pricing', '/pricing'],
  ]) {
    assert.equal(
      await page
        .getByRole('navigation', { name: 'Public pages' })
        .first()
        .getByRole('link', { name })
        .getAttribute('href'),
      href,
    );
  }
  assert.equal((await page.locator('main').textContent()).includes('$149'), false);
  assert.equal((await page.locator('body').textContent()).includes('Request pilot access'), false);
  assert.equal(await page.locator('img[src="/landing/coverage-map-circle.webp"]').count(), 1);
  assert.equal(
    await page.locator('video[src="/landing/outreach-progress-presentation.mp4"]').count(),
    1,
  );
  assert.equal(await page.locator('.coverage-proof figcaption').count(), 0);
  assert.equal(await page.locator('.progress-projector').count(), 1);
  assert.equal(await page.locator('[data-reveal="workflow"]').count(), 1);
  for (const name of ['churchName', 'contactName', 'email', 'location', 'outreachProcess']) {
    assert.equal(await page.locator(`[name="${name}"]`).count(), 1);
  }
  const honeypot = page.locator('input[name="website"]');
  assert.equal(await honeypot.getAttribute('tabindex'), '-1');
  assert.equal(await honeypot.locator('xpath=..').getAttribute('aria-hidden'), 'true');
});

test('the landing presentation plays in view and respects reduced motion', async (t) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  t.after(() => page.close());
  let videoRequests = 0;
  await page.route('https://streetlight.test/**', (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('.mp4')) {
      videoRequests += 1;
      return route.fulfill({
        contentType: 'video/mp4',
        body: readFileSync(new URL(`../public${pathname}`, import.meta.url)),
      });
    }
    return route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
    });
  });
  await page.setContent(`
    <base href="https://streetlight.test/">
    <style>${publicLandingStyles}</style>
    ${renderToStaticMarkup(createElement(PublicLanding))}
  `);
  await page.addScriptTag({ content: publicLandingMotion });
  assert.equal(videoRequests, 0, 'the initial page must not download the video');

  const video = page.locator('.projector-screen video');
  const showVideo = () => scrollElementToViewportRatio(page, '.projector-screen', 0.2);
  const hideVideo = () => page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  const waitPaused = (paused) =>
    page.waitForFunction((expected) => document.querySelector('video').paused === expected, paused);

  await showVideo();
  await page.waitForFunction(() => document.querySelector('video').currentTime > 0.1);
  await hideVideo();
  await waitPaused(true);
  await showVideo();
  await waitPaused(false);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await waitPaused(true);
  await hideVideo();
  await showVideo();
  assert.equal(await video.evaluate((element) => element.paused), true);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await waitPaused(false);
  assert.equal(await video.evaluate((element) => !element.controls && element.muted), true);
});

test('all three public pages render shared navigation and the approved product promises', async (t) => {
  const pages = [
    {
      component: HowItWorksPage,
      heading: 'How it works',
    },
    { component: WhyStreetlightPage, heading: 'It started with my own church.' },
    { component: PricingPage, heading: 'One plan for the whole church.' },
  ];

  for (const expected of pages) {
    const page = await render(createElement(expected.component));
    t.after(() => page.close());
    await page.getByRole('heading', { level: 1, name: expected.heading }).waitFor();
    const navigation = page.getByRole('navigation', { name: 'Main navigation' });
    for (const name of ['Home', 'How it works', 'Why Streetlight', 'Pricing']) {
      assert.equal(await navigation.getByRole('link', { name }).count(), 1);
    }
    assert.equal(
      await page
        .getByRole('button', { name: 'Request access', exact: true })
        .first()
        .evaluate((element) => element.hasAttribute('data-public-access-open')),
      true,
    );
  }

  const pricing = await render(createElement(PricingPage));
  t.after(() => pricing.close());
  const pricingText = await pricing.locator('main').textContent();
  assert.ok(pricingText.indexOf('$149') < pricingText.indexOf('$15'));
  assert.ok(pricingText.includes('90 days'));
  assert.ok(pricingText.includes('No credit card required'));
});
