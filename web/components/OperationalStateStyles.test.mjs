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

test('inactive tool hover uses the approved cream treatment without covering selection', async () => {
  await withToolSwitcher(async (page) => {
    const inactive = page.getByRole('button', { name: 'Generate' });
    await inactive.hover();

    assert.equal(
      await inactive.evaluate((element) => getComputedStyle(element).backgroundColor),
      'rgba(251, 248, 242, 0.1)',
    );
    assert.equal(await inactive.evaluate((element) => getComputedStyle(element).boxShadow), 'none');
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

test('map settings controls keep 44px hit targets at desktop and tablet widths', async () => {
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
            <button aria-label="Open map settings" class="coverage-legend-settings"></button>
          </fieldset>
          <section class="heatmap-settings-dialog">
            <header>
              <h2>Map settings</h2>
              <button aria-label="Close map settings" class="icon-button"></button>
            </header>
          </section>
        </section>
      `);

      for (const name of ['Open map settings', 'Close map settings']) {
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

test('the map display switch keeps its control styling inside the heatmap form', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(
      '<style>' +
        styles +
        '</style>' +
        '<section class="heatmap-settings-dialog">' +
        '<form class="heatmap-settings-form">' +
        '<label>Yellow starts at <span><input type="number" value="90"> days</span></label>' +
        '<section class="map-display-settings">' +
        '<label class="map-display-toggle">' +
        '<span>Show apartment markers</span>' +
        '<input checked role="switch" type="checkbox">' +
        '</label></section></form></section>',
    );

    const toggle = page.getByRole('switch', { name: 'Show apartment markers' });
    const toggleStyle = await toggle.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        borderRadius: style.borderRadius,
        height: style.height,
        width: style.width,
      };
    });

    assert.deepEqual(toggleStyle, { borderRadius: '999px', height: '24px', width: '42px' });
    assert.equal(
      await toggle.locator('..').evaluate((element) => getComputedStyle(element).display),
      'flex',
    );
  } finally {
    await browser.close();
  }
});

test('packet finalization status keeps its spinner beside one-line left-aligned copy', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 760, height: 500 } });
    await page.setContent(`
      <style>${styles}</style>
      <main class="territory-page">
        <section class="packet-confirmation" style="width: 640px">
          <div class="operation-status surface busy">
            <span class="operation-status-cue"></span>
            <div class="operation-status-copy">
              <strong>Finalizing packet batch</strong>
              <span>Streetlight is reserving this batch before preparing its PDF.</span>
            </div>
          </div>
        </section>
      </main>
    `);

    const cue = await page.locator('.operation-status-cue').boundingBox();
    const copy = await page.locator('.operation-status-copy').boundingBox();
    const detail = await page.locator('.operation-status-copy span').boundingBox();
    assert.ok(cue && copy && detail);
    assert.ok(copy.x - cue.x < 50, `copy started ${copy.x - cue.x}px after the spinner`);
    assert.ok(detail.height < 20, `detail wrapped to ${detail.height}px`);
  } finally {
    await browser.close();
  }
});
