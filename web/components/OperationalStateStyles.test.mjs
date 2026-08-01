import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';

const styles = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8').replace(
  /^@import[^\n]+\n/,
  '',
);
const publicStyles = readFileSync(
  new URL('../public/landing/spread-the-light-v2.css', import.meta.url),
  'utf8',
);

async function withToolSwitcher(run, reducedMotion = 'no-preference') {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ reducedMotion });
    await page.setContent(`
      <style>${styles}</style>
      <div class="territory-page">
        <nav aria-label="Administrator tools" class="workspace-tools">
          <button class="active" type="button">Coverage</button>
          <button type="button">Generate</button>
          <button type="button">Reconcile</button>
          <button type="button">Territory</button>
        </nav>
      </div>
    `);
    await run(page);
  } finally {
    await browser.close();
  }
}

test('inactive tool hover leaves the moving selection indicator uncovered', async () => {
  await withToolSwitcher(async (page) => {
    const inactive = page.getByRole('button', { name: 'Generate' });
    await inactive.hover();

    assert.equal(
      await inactive.evaluate((element) => getComputedStyle(element).backgroundColor),
      'rgba(0, 0, 0, 0)',
    );
    assert.notEqual(
      await inactive.evaluate((element) => getComputedStyle(element).boxShadow),
      'none',
    );
    assert.equal(
      await page
        .locator('.workspace-tools')
        .evaluate((element) => getComputedStyle(element, '::before').backgroundColor),
      'rgb(16, 26, 41)',
    );
  });
});

test('workspace controls use the selected blue focus ring on paper', async () => {
  await withToolSwitcher(async (page) => {
    await page.keyboard.press('Tab');
    const active = page.getByRole('button', { name: 'Coverage' });

    assert.equal(
      await active.evaluate((element) => getComputedStyle(element).outlineColor),
      'rgb(39, 103, 233)',
    );
    assert.equal(await active.evaluate((element) => getComputedStyle(element).outlineWidth), '3px');
  });
});

test('public landing controls retain their wider blue focus treatment', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <style>${styles}</style>
      <style>${publicStyles}</style>
      <main><button class="button button-solid" type="button">Request pilot access</button></main>
    `);
    await page.keyboard.press('Tab');
    const control = page.getByRole('button', { name: 'Request pilot access' });

    assert.equal(
      await control.evaluate((element) => getComputedStyle(element).outlineColor),
      'rgb(94, 142, 255)',
    );
    assert.equal(
      await control.evaluate((element) => getComputedStyle(element).outlineWidth),
      '3px',
    );
    assert.equal(
      await control.evaluate((element) => getComputedStyle(element).outlineOffset),
      '4px',
    );
  } finally {
    await browser.close();
  }
});

test('reduced motion removes the indicator slide without weakening selection', async () => {
  await withToolSwitcher(async (page) => {
    const nav = page.locator('.workspace-tools');
    assert.equal(
      await nav.evaluate((element) => getComputedStyle(element, '::before').transitionDuration),
      '0s',
    );
    assert.equal(
      await nav.evaluate((element) => getComputedStyle(element, '::before').backgroundColor),
      'rgb(16, 26, 41)',
    );
    assert.equal(
      await page
        .getByRole('button', { name: 'Coverage' })
        .evaluate((element) => getComputedStyle(element).color),
      'rgb(255, 255, 255)',
    );
  }, 'reduce');
});

test('heatmap settings controls keep 44px hit targets at desktop and tablet widths', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 768, height: 1024 },
    ]) {
      const page = await browser.newPage({ viewport });
      await page.setContent(`
        <style>${styles}</style>
        <section class="map-panel">
          <fieldset class="map-legend coverage-legend">
            <button aria-label="Edit heatmap ranges" class="coverage-legend-settings"></button>
          </fieldset>
          <section class="heatmap-settings-dialog">
            <header>
              <h2>Heatmap ranges</h2>
              <button aria-label="Close heatmap settings" class="icon-button"></button>
            </header>
          </section>
        </section>
      `);

      for (const name of ['Edit heatmap ranges', 'Close heatmap settings']) {
        const box = await page.getByRole('button', { name }).boundingBox();
        assert.ok(box);
        assert.ok(box.width >= 44, `${name} width was ${box.width}px at ${viewport.width}px`);
        assert.ok(box.height >= 44, `${name} height was ${box.height}px at ${viewport.width}px`);
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
