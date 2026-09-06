import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { POST } from '../app/api/pilot-requests/route.ts';
import HowItWorksPage from '../app/how-it-works/page.tsx';
import PricingPage, { metadata as pricingMetadata } from '../app/pricing/page.tsx';
import WhyStreetlightPage from '../app/why-streetlight/page.tsx';
import { PUBLIC_RELEASE_ENABLED } from '../lib/public-site.ts';
import { PublicLanding } from './PublicLanding.tsx';

test('the release flag controls pages and trial copy while access requests remain available', async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const expectedLinks = PUBLIC_RELEASE_ENABLED
    ? ['/', '/how-it-works', '/why-streetlight', '/pricing']
    : ['/', '/how-it-works'];

  for (const component of [PublicLanding, HowItWorksPage]) {
    await page.setContent(renderToStaticMarkup(createElement(component)));
    assert.deepEqual(
      await page
        .locator('header nav a')
        .evaluateAll((links) => links.map((link) => link.getAttribute('href'))),
      expectedLinks,
    );
    assert.deepEqual(
      await page
        .locator('footer nav a:not([href^="mailto:"])')
        .evaluateAll((links) => links.map((link) => link.getAttribute('href'))),
      expectedLinks,
    );
    assert.equal(
      await page.locator('a[href="/login"]').count(),
      component === HowItWorksPage ? 1 : 2,
    );
    assert.equal(await page.locator('dialog').count(), 1);
    assert.equal(await page.locator('[data-pilot-open], [data-public-access-open]').count(), 2);
    assert.equal(
      /free trial|credit card|pricing/i.test(await page.locator('body').textContent()),
      PUBLIC_RELEASE_ENABLED,
    );
  }

  for (const component of [WhyStreetlightPage, PricingPage]) {
    if (PUBLIC_RELEASE_ENABLED) {
      assert.doesNotThrow(() => renderToStaticMarkup(createElement(component)));
    } else {
      assert.throws(() => renderToStaticMarkup(createElement(component)), {
        digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
      });
    }
  }
  if (!PUBLIC_RELEASE_ENABLED) assert.deepEqual(pricingMetadata, {});

  // Requests reach validation in both stages without this check writing to a database.
  const response = await POST(
    new Request('http://streetlight.test/api/pilot-requests', { method: 'POST', body: '{}' }),
  );
  assert.equal(response.status, 400);
});
