import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import '../test/public-release.mjs';

const { default: HowItWorksPage } = await import('../app/how-it-works/page.tsx');
const { default: PricingPage } = await import('../app/pricing/page.tsx');
const { default: WhyStreetlightPage } = await import('../app/why-streetlight/page.tsx');

const styles = [
  new URL('../app/globals.css', import.meta.url),
  new URL('../public/landing/public-pages-v1.css', import.meta.url),
  new URL('../public/landing/public-site-chrome.css', import.meta.url),
]
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n');

test('public pages keep their content visible at phone, tablet, and desktop widths', async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  await page.route('https://streetlight.test/**', (route) => {
    const pathname = new URL(route.request().url()).pathname;
    return route.fulfill({
      body: readFileSync(new URL(`../public${pathname}`, import.meta.url)),
      contentType: pathname.endsWith('.css') ? 'text/css' : 'image/webp',
    });
  });

  for (const component of [HowItWorksPage, WhyStreetlightPage, PricingPage]) {
    await page.setContent(`<!doctype html><html lang="en"><head>
      <base href="https://streetlight.test/"><style>${styles}</style>
      </head><body>${renderToStaticMarkup(createElement(component))}</body></html>`);
    await page.addScriptTag({
      content: readFileSync(
        new URL('../public/landing/public-pages-v1.js', import.meta.url),
        'utf8',
      ),
    });
    if (component === PricingPage) {
      for (const summary of await page.locator('summary').all()) {
        await summary.focus();
        await page.keyboard.press('Enter');
      }
      assert.equal(await page.locator('details[open]').count(), 7);
    }
    for (const width of [320, 820, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      const heading = page.locator('main h2').last();
      await heading.evaluate((element) =>
        element.scrollIntoView({ block: 'start', behavior: 'instant' }),
      );
      const headerBox = await page.locator('.public-shell-header').boundingBox();
      const headingBox = await heading.boundingBox();
      assert.equal(headerBox.y, 0, `${component.name} keeps navigation visible at ${width}px`);
      assert.ok(
        headingBox.y >= headerBox.height,
        `${component.name} scrolls headings clear of navigation at ${width}px`,
      );
      const clipped = await page.locator('main').evaluate((main) =>
        [...main.querySelectorAll('*')]
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && (rect.left < -1 || rect.right > innerWidth + 1);
          })
          .map((element) => element.className || element.tagName),
      );
      assert.deepEqual(clipped, [], `${component.name} clips content at ${width}px`);
      for (const link of await page.locator('.public-shell-header a').all()) {
        const box = await link.boundingBox();
        assert.ok(box.height >= 44, `${await link.textContent()} is too short at ${width}px`);
      }
    }
  }
});

test('FAQ motion opens, closes, and reverses without leaving answers stuck', async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><html><head><style>${styles}</style></head>
    <body>${renderToStaticMarkup(createElement(PricingPage))}</body></html>`);
  await page.addScriptTag({
    content: readFileSync(new URL('../public/landing/public-pages-v1.js', import.meta.url), 'utf8'),
  });
  const details = page.locator('.pricing-faq details').first();
  const summary = details.locator('summary');
  await summary.focus();
  await page.keyboard.press('Enter');
  assert.equal(await details.locator('.faq-answer').evaluate((el) => el.getAnimations().length), 1);
  await page.waitForFunction(() => !document.querySelector('.faq-answer').getAnimations().length);
  assert.equal(await details.evaluate((el) => el.open), true);
  await page.keyboard.press('Enter');
  assert.equal(await details.evaluate((el) => el.open), true);
  await page.waitForFunction(() => !document.querySelector('.pricing-faq details').open);

  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('.faq-answer').getAnimations().length);
  assert.equal(await details.evaluate((el) => el.open), true);
  assert.ok(
    await details.locator('.faq-answer').evaluate((el) => el.getBoundingClientRect().height > 0),
  );

  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(
    await page.locator('html').evaluate((el) => getComputedStyle(el).scrollBehavior),
    'auto',
  );
  await page.keyboard.press('Enter');
  assert.equal(await details.evaluate((el) => el.open), false);
  assert.equal(await details.locator('.faq-answer').evaluate((el) => el.getAnimations().length), 0);
});

test('image motion follows scroll position, reverses, and stops for reduced motion', async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.route('https://streetlight.test/**', (route) => {
      const pathname = new URL(route.request().url()).pathname;
      return route.fulfill({
        body: readFileSync(new URL(`../public${pathname}`, import.meta.url)),
        contentType: pathname.endsWith('.css') ? 'text/css' : 'image/webp',
      });
    });
    for (const [component, selector] of [
      [WhyStreetlightPage, '.progress-frames > figure:last-child'],
    ]) {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.setContent(`<!doctype html><html><head>
        <base href="https://streetlight.test/"><style>${styles}</style></head>
        <body>${renderToStaticMarkup(createElement(component))}</body></html>`);
      await page.locator('img').evaluateAll((images) => {
        images.forEach((image) => {
          image.loading = 'eager';
        });
      });
      await page.evaluate(() => Promise.all([...document.images].map((image) => image.decode())));
      await page.addScriptTag({
        content: readFileSync(
          new URL('../public/landing/public-pages-v1.js', import.meta.url),
          'utf8',
        ),
      });
      const figure = page.locator(selector);
      const sampleAt = async (viewportPosition) => {
        await figure.evaluate((element, position) => {
          window.scrollTo({
            top: window.scrollY + element.getBoundingClientRect().top - innerHeight * position,
            behavior: 'instant',
          });
        }, viewportPosition);
        await page.evaluate(
          () =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        );
        return figure.locator('img').getAttribute('style');
      };
      const entering = await sampleAt(0.85);
      assert.ok(entering.includes('opacity'), `${selector} has scroll motion at ${width}px`);
      await page.waitForTimeout(750);
      assert.equal(await figure.locator('img').getAttribute('style'), entering, 'scrolling paused');
      const farther = await sampleAt(0.5);
      assert.notEqual(farther, entering, 'scrolling forward advances the reveal');
      assert.equal(await sampleAt(0.85), entering, 'scrolling back restores the same frame');
      assert.equal(await sampleAt(0.05), '', 'the image is fully revealed before leaving view');
      await sampleAt(0.85);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.waitForFunction(
        (target) => !document.querySelector(target).querySelector('img').getAttribute('style'),
        selector,
      );
    }
    await page.close();
  }
});
