import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PublicAccessDrawer } from './PublicAccessDrawer.tsx';
import { PublicLanding } from './PublicLanding.tsx';

const styles = [
  '../app/globals.css',
  '../public/landing/public-pages-v1.css',
  '../public/landing/public-access.css',
]
  .map((file) => readFileSync(new URL(file, import.meta.url), 'utf8'))
  .join('\n');
const script = readFileSync(new URL('../public/landing/public-access.js', import.meta.url), 'utf8');

test('Home preserves access drafts and recovers from network and non-JSON errors', async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  });
  const landingStyles = readFileSync(
    new URL('../public/landing/spread-the-light-v2.css', import.meta.url),
    'utf8',
  );
  let submissions = 0;
  await page.route('https://streetlight.test/**', async (route) => {
    if (route.request().url().includes('/api/pilot-requests')) {
      submissions += 1;
      if (submissions === 1) return route.abort('internetdisconnected');
      if (submissions === 2) {
        return route.fulfill({
          status: 500,
          contentType: 'text/html',
          body: '<h1>Unavailable</h1>',
        });
      }
      return route.fulfill({ json: { message: 'Request received.' } });
    }
    if (route.request().resourceType() !== 'document') return route.abort();
    return route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="en"><head><style>${landingStyles}</style></head><body>${renderToStaticMarkup(createElement(PublicLanding))}</body></html>`,
    });
  });
  await page.goto('https://streetlight.test/?review=access#top');
  await page.addScriptTag({
    content: readFileSync(
      new URL('../public/landing/spread-the-light-v2.js', import.meta.url),
      'utf8',
    ),
  });
  const originalUrl = page.url();
  const opener = page.locator('[data-pilot-open]').first();
  const dialog = page.locator('#pilot-dialog');
  await opener.click();
  const fields = {
    'Church name': 'Example church',
    'Your name': 'Ben',
    Email: 'ben@example.test',
    'City and state': 'Temecula, CA',
  };
  for (const [label, value] of Object.entries(fields)) {
    await dialog.getByLabel(label, { exact: true }).fill(value);
  }
  const bounds = await dialog.boundingBox();
  await page.mouse.click(bounds.x + 10, bounds.height - 10);
  assert.equal(await dialog.evaluate((el) => el.open), true, 'inside padding is not the backdrop');

  for (const close of [
    () => page.keyboard.press('Escape'),
    () => dialog.getByRole('button', { name: 'Close access request', exact: true }).click(),
    () => page.mouse.click(20, 200),
  ]) {
    await close();
    await page.waitForFunction(() => !document.querySelector('dialog').open);
    await opener.click();
    for (const [label, value] of Object.entries(fields)) {
      assert.equal(await dialog.getByLabel(label, { exact: true }).inputValue(), value);
    }
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await dialog.locator('[type=submit]').click();
    await dialog.locator('[role=alert]').waitFor({ state: 'visible' });
    assert.equal(
      await dialog.locator('[role=alert]').textContent(),
      'Unable to send your request. Please try again.',
    );
    assert.equal(
      await dialog.getByLabel('Church name', { exact: true }).inputValue(),
      fields['Church name'],
    );
  }
  await dialog.locator('[type=submit]').click();
  await dialog.locator('.drawer-success').waitFor({ state: 'visible' });
  assert.equal(await dialog.locator('[data-pilot-message]').textContent(), 'Request received.');
  await page.keyboard.press('Escape');
  await opener.click();
  assert.equal(await dialog.locator('.drawer-success').isVisible(), true);
  assert.equal(submissions, 3);
  assert.equal(page.url(), originalUrl);
});

test('access requests stay on the current page with native modal controls and recoverable submission', async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());

  for (const [width, reducedMotion] of [
    [1440, 'no-preference'],
    [390, 'no-preference'],
    [1440, 'reduce'],
  ]) {
    await t.test(`${width}px, ${reducedMotion}`, async () => {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion });
      const requests = [];
      let releaseRequest;
      let requestReceived = Promise.withResolvers();
      await page.route('https://streetlight.test/**', async (route) => {
        if (route.request().url().includes('/api/pilot-requests')) {
          requests.push(route.request().postDataJSON());
          const responseGate = new Promise((resolve) => {
            releaseRequest = resolve;
          });
          requestReceived.resolve();
          await responseGate;
          return route.fulfill({
            status: requests.length === 1 ? 503 : 200,
            json:
              requests.length === 1
                ? { error: 'Please try again later.' }
                : {
                    message:
                      "Request received. We'll review it and contact you at ben@example.test.",
                  },
          });
        }
        return route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><html lang="en"><head><style>${styles}</style></head><body>
            <div class="public-page"><button id="outside">Outside the dialog</button>
            <main style="min-height:2400px;padding-top:1000px">
              <button id="request" type="button" data-public-access-open>Request access</button>
            </main>${renderToStaticMarkup(createElement(PublicAccessDrawer))}</div></body></html>`,
        });
      });
      await page.goto('https://streetlight.test/pricing?plan=annual#questions');
      await page.addScriptTag({ content: script });
      await page.evaluate(() => window.scrollTo({ top: 850, behavior: 'instant' }));
      const originalUrl = page.url();
      const originalScroll = await page.evaluate(() => window.scrollY);
      const dialog = page.locator('#public-access-dialog');

      await page.locator('#request').click();
      assert.equal(await dialog.evaluate((element) => element.matches(':modal')), true);
      assert.equal(
        await page.locator('#public-access-title').evaluate((el) => el === document.activeElement),
        true,
      );
      assert.equal(page.url(), originalUrl);
      const duration = await dialog.evaluate(
        (element) => getComputedStyle(element).transitionDuration,
      );
      assert.equal(duration, reducedMotion === 'reduce' ? '0s' : '0.38s, 0.38s, 0.38s');
      await dialog.evaluate(async (element) => {
        await Promise.all(element.getAnimations().map((animation) => animation.finished));
      });
      const drawerBounds = await dialog.boundingBox();
      assert.ok(
        drawerBounds.x >= 0 && drawerBounds.x + drawerBounds.width <= width,
        JSON.stringify(drawerBounds),
      );
      await page.mouse.click(drawerBounds.x + 10, 10);
      assert.equal(await dialog.evaluate((element) => element.open), true);
      for (let tab = 0; tab < 9; tab += 1) {
        await page.keyboard.press('Tab');
        assert.equal(
          await dialog.evaluate(
            (element) =>
              element.contains(document.activeElement) || document.activeElement === document.body,
          ),
          true,
        );
      }
      await page.keyboard.press('Escape');
      await page.waitForFunction(
        () => getComputedStyle(document.querySelector('dialog')).display === 'none',
      );
      assert.equal(
        await page.locator('#request').evaluate((el) => el === document.activeElement),
        true,
      );
      assert.equal(await page.evaluate(() => window.scrollY), originalScroll);
      assert.equal(page.url(), originalUrl);

      await page.locator('#request').click();
      if (width > 760) {
        await page.mouse.click(20, 200);
        await page.waitForFunction(
          () => getComputedStyle(document.querySelector('dialog')).display === 'none',
        );
        await page.locator('#request').click();
      }
      await dialog.locator('[type=submit]').click();
      assert.equal(requests.length, 0, 'native validity prevents incomplete requests');
      await dialog.getByLabel('Church name', { exact: true }).fill('Example church');
      await dialog.getByLabel('Your name', { exact: true }).fill('Ben');
      await dialog.getByLabel('Email', { exact: true }).fill('ben@example.test');
      await dialog.getByLabel('City and state', { exact: true }).fill('Temecula, CA');
      await dialog
        .getByLabel('How do you organize outreach today?', { exact: false })
        .fill('Printed maps');
      await dialog.locator('[type=submit]').click();
      await page.waitForFunction(() => document.querySelector('[type=submit]').disabled);
      assert.equal(await dialog.locator('[type=submit]').textContent(), 'Sending…');
      assert.equal(await dialog.locator('form').getAttribute('aria-busy'), 'true');
      await requestReceived.promise;
      assert.equal(requests.length, 1);
      assert.deepEqual(requests[0], {
        churchName: 'Example church',
        contactName: 'Ben',
        email: 'ben@example.test',
        location: 'Temecula, CA',
        outreachProcess: 'Printed maps',
        website: '',
      });
      releaseRequest();
      await dialog.locator('[role=alert]').waitFor({ state: 'visible' });
      assert.equal(await dialog.locator('[role=alert]').textContent(), 'Please try again later.');
      assert.equal(
        await dialog.getByLabel('Church name', { exact: true }).inputValue(),
        'Example church',
      );
      requestReceived = Promise.withResolvers();
      await dialog.locator('[type=submit]').click();
      await page.waitForFunction(() => document.querySelector('[type=submit]').disabled);
      await requestReceived.promise;
      releaseRequest();
      await dialog.locator('.public-access-success').waitFor({ state: 'visible' });
      assert.equal(await dialog.locator('form').isVisible(), false);
      assert.equal(
        await dialog
          .getByText("Request received. We'll review it and contact you at ben@example.test.")
          .isVisible(),
        true,
      );
      await dialog.getByRole('button', { name: 'Back to Streetlight' }).click();
      await page.waitForFunction(
        () => getComputedStyle(document.querySelector('dialog')).display === 'none',
      );
      assert.equal(page.url(), originalUrl);
      assert.equal(await page.evaluate(() => window.scrollY), originalScroll);
      assert.equal(
        await page.locator('#request').evaluate((el) => el === document.activeElement),
        true,
      );
      await page.close();
    });
  }
});
