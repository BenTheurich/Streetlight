import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';

// Repository policy: these tests execute the production stylesheet in Chromium because clipping
// geometry and scrollbar gutters are computed-layout behavior, not stable source syntax.
const styles = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8').replace(
  /^@import[^;]+;\s*/,
  '',
);
const progressMapSource = readFileSync(new URL('./OpenProgressMap.tsx', import.meta.url), 'utf8');

test('progress map replaces lifecycle ownership before releasing the previous frame', () => {
  const publish = progressMapSource.indexOf('release: lifecycle.present({');
  const releasePrevious = progressMapSource.indexOf('previous?.release();');
  assert.ok(publish >= 0);
  assert.ok(releasePrevious > publish);
  assert.match(progressMapSource, /current\.release\(\);\s*releaseRef\.current = null;/);
});

test('print preparation uses the final paper map dimensions before opening the dialog', async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1920, height: 945 } });

  await page.setContent(`
    <style>${styles}</style>
    <div class="territory-page progress-stage progress-print">
      <main class="territory-workspace">
        <section class="map-panel"></section>
        <aside class="territory-sidebar progress-stage-sidebar"></aside>
      </main>
    </div>
  `);

  const geometry = await page.locator('.territory-page').evaluate((element) => {
    const pageRect = element.getBoundingClientRect();
    const mapRect = element.querySelector('.map-panel').getBoundingClientRect();
    return {
      mapHeight: mapRect.height,
      mapWidth: mapRect.width,
      pageHeight: pageRect.height,
      pageWidth: pageRect.width,
    };
  });

  assert.equal(geometry.pageHeight, 816);
  assert.equal(geometry.pageWidth, 1056);
  assert.ok(Math.abs(geometry.mapHeight - 748.8) < 0.1);
  assert.ok(Math.abs(geometry.mapWidth - 672) < 0.1);
});

test('Setup disclosure controls stay inside both horizontal clipping edges', async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 800 } });

  await page.setContent(`
    <style>${styles}</style>
    <div class="territory-page">
      <details class="region-settings-disclosure" open style="width: 326px">
        <summary>Region settings</summary>
        <section class="territory-basics-section">
          <div class="region-settings-row">
            <h2>Church location</h2>
            <div class="address-card">
              <strong>31087 Nicolas Rd, Temecula, CA 92591, United States</strong>
              <button type="button">Change</button>
            </div>
          </div>
          <div class="region-settings-row">
            <div class="address-editor">
              <label>Church or address</label>
              <div>
                <gmp-place-autocomplete class="territory-place-autocomplete">
                  <span style="display: block; width: 320px">Address search</span>
                </gmp-place-autocomplete>
              </div>
              <div class="address-editor-actions"><button type="button">Cancel</button></div>
            </div>
          </div>
          <fieldset class="region-settings-row boundary-shape-control">
            <legend>Boundary shape</legend>
            <div><button class="active" type="button">Circle</button><button type="button">Square</button></div>
          </fieldset>
          <div class="region-settings-row radius-control">
            <input aria-label="Region boundary distance" max="5" min="1" type="range" value="5" />
          </div>
        </section>
      </details>
    </div>
  `);

  const range = page.getByRole('slider', { name: 'Region boundary distance' });
  await range.focus();
  const geometry = await page.locator('.region-settings-disclosure').evaluate((details) => {
    const boundary = details.getBoundingClientRect();
    const rangeInput = details.querySelector('input[type="range"]');
    const placeInput = details.querySelector('.territory-place-autocomplete');
    const addressCard = details.querySelector('.address-card');
    const addressText = addressCard.querySelector('strong');
    const addressButton = addressCard.querySelector('button');
    const shapeControl = details.querySelector('.boundary-shape-control > div');
    const rangeRect = rangeInput.getBoundingClientRect();
    const placeRect = placeInput.getBoundingClientRect();
    const addressRect = addressCard.getBoundingClientRect();
    const addressTextRect = addressText.getBoundingClientRect();
    const addressButtonRect = addressButton.getBoundingClientRect();
    const shapeRect = shapeControl.getBoundingClientRect();
    const rangeStyle = getComputedStyle(rangeInput);
    const addressStyle = getComputedStyle(addressCard);
    const outlineOutside = Math.max(
      0,
      Number.parseFloat(rangeStyle.outlineWidth) + Number.parseFloat(rangeStyle.outlineOffset),
    );
    return {
      boundary: { left: boundary.left, right: boundary.right },
      address: {
        background: addressStyle.backgroundColor,
        borderWidth: addressStyle.borderTopWidth,
        height: addressRect.height,
        left: addressRect.left,
        right: addressRect.right,
        textRight: addressTextRect.right,
        buttonLeft: addressButtonRect.left,
      },
      place: { left: placeRect.left, right: placeRect.right },
      range: {
        left: rangeRect.left - outlineOutside,
        right: rangeRect.right + outlineOutside,
      },
      shape: { height: shapeRect.height },
    };
  });

  assert.ok(geometry.range.left >= geometry.boundary.left - 0.5);
  assert.ok(geometry.range.right <= geometry.boundary.right + 0.5);
  assert.equal(geometry.address.borderWidth, '1px');
  assert.equal(geometry.address.background, 'rgb(250, 247, 240)');
  assert.equal(geometry.address.height, geometry.shape.height);
  assert.ok(geometry.address.left >= geometry.boundary.left - 0.5);
  assert.ok(geometry.address.right <= geometry.boundary.right + 0.5);
  assert.ok(geometry.address.textRight <= geometry.address.buttonLeft);
  assert.ok(geometry.place.left >= geometry.boundary.left - 0.5);
  assert.ok(geometry.place.right <= geometry.boundary.right + 0.5);
});

test('workspace scrollbars keep their themed gutter before content overflows', async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 800 } });

  await page.setContent(`
    <style>${styles}</style>
    <div class="territory-page">
      <div class="sidebar-scroll" style="height: 120px; width: 326px">
        <div class="scrollbar-test-content">Content</div>
      </div>
      <div class="road-search-results"></div>
      <div class="apartment-search-results"></div>
      <div class="heatmap-settings-dialog"></div>
    </div>
  `);

  const scroller = page.locator('.sidebar-scroll');
  const widthBeforeOverflow = await page
    .locator('.scrollbar-test-content')
    .evaluate((element) => element.getBoundingClientRect().width);
  await page.locator('.scrollbar-test-content').evaluate((element) => {
    element.style.height = '300px';
  });
  const widthAfterOverflow = await page
    .locator('.scrollbar-test-content')
    .evaluate((element) => element.getBoundingClientRect().width);
  const scrollbarStyle = await scroller.evaluate((element) => ({
    gutter: getComputedStyle(element).scrollbarGutter,
    thumb: getComputedStyle(element, '::-webkit-scrollbar-thumb').backgroundColor,
    width: getComputedStyle(element, '::-webkit-scrollbar').width,
  }));
  const reservedGutters = await page
    .locator(
      '.sidebar-scroll, .road-search-results, .apartment-search-results, .heatmap-settings-dialog',
    )
    .evaluateAll((elements) =>
      elements.map((element) => getComputedStyle(element).scrollbarGutter),
    );
  const trackColors = await page
    .locator(
      '.sidebar-scroll, .road-search-results, .apartment-search-results, .heatmap-settings-dialog',
    )
    .evaluateAll((elements) =>
      elements.map(
        (element) => getComputedStyle(element, '::-webkit-scrollbar-track').backgroundColor,
      ),
    );

  assert.equal(widthAfterOverflow, widthBeforeOverflow);
  assert.deepEqual(reservedGutters, ['stable', 'stable', 'stable', 'stable']);
  assert.deepEqual(trackColors, [
    'rgba(0, 0, 0, 0)',
    'rgb(216, 207, 191)',
    'rgb(216, 207, 191)',
    'rgba(0, 0, 0, 0)',
  ]);
  assert.equal(scrollbarStyle.width, '8px');
  assert.equal(scrollbarStyle.thumb, 'rgb(148, 141, 131)');
});
