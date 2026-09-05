import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';
import ts from 'typescript';

// Repository policy: these tests execute the production stylesheet in Chromium because clipping
// geometry and scrollbar gutters are computed-layout behavior, not stable source syntax.
const styles = ['globals.css', 'workspace.css']
  .map((filename) =>
    readFileSync(new URL(`../app/${filename}`, import.meta.url), 'utf8').replace(
      /^@import[^;]+;\s*/,
      '',
    ),
  )
  .join('\n');
const require = createRequire(import.meta.url);
const reactDirectory = path.dirname(require.resolve('react/package.json'));
const domDirectory = path.dirname(require.resolve('react-dom/package.json'));
const schedulerDirectory = path.dirname(
  createRequire(require.resolve('react-dom')).resolve('scheduler/package.json'),
);
// Execute the installed React runtime and production progress modules in a browser without a dev server.
const browserModules = {
  react: path.join(reactDirectory, 'cjs/react.development.js'),
  'react/jsx-runtime': path.join(reactDirectory, 'cjs/react-jsx-runtime.development.js'),
  'react-dom': path.join(domDirectory, 'cjs/react-dom.development.js'),
  'react-dom/client': path.join(domDirectory, 'cjs/react-dom-client.development.js'),
  scheduler: path.join(schedulerDirectory, 'cjs/scheduler.development.js'),
  OpenProgressMap: new URL('./OpenProgressMap.tsx', import.meta.url),
  useOutreachProgress: new URL('./useOutreachProgress.ts', import.meta.url),
  '@/lib/outreach-progress-workflow': new URL(
    '../lib/outreach-progress-workflow.ts',
    import.meta.url,
  ),
  './outreach-progress.ts': new URL('../lib/outreach-progress.ts', import.meta.url),
};
const progressBrowserScript = `
  const process = { env: { NODE_ENV: 'development' } };
  const modules = {${Object.entries(browserModules)
    .map(([name, filename]) => {
      const source = readFileSync(filename, 'utf8');
      const code =
        filename instanceof URL
          ? ts.transpileModule(source, {
              compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                jsx: ts.JsxEmit.ReactJSX,
                target: ts.ScriptTarget.ES2022,
              },
            }).outputText
          : source;
      return `${JSON.stringify(name)}: (require, module, exports) => {${code}\n}`;
    })
    .join(',')}};
  const cache = {};
  window.fixtureRequire = (name) => {
    if (!cache[name]) {
      cache[name] = { exports: {} };
      modules[name](window.fixtureRequire, cache[name], cache[name].exports);
    }
    return cache[name].exports;
  };
`;

test('progress map updates preserve visible ownership and unmount releases the final presentation', async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: progressBrowserScript });
  await page.evaluate(() => {
    const { createElement } = window.fixtureRequire('react');
    const { createRoot } = window.fixtureRequire('react-dom/client');
    const { OpenProgressMap } = window.fixtureRequire('OpenProgressMap');
    const root = createRoot(document.querySelector('#root'));
    let current;
    window.events = [];
    const lifecycle = {
      present(value) {
        current = value;
        window.events.push(['present', value.position]);
        return () => {
          if (current === value) {
            current = null;
            window.events.push(['hidden', value.position]);
          }
        };
      },
    };
    window.update = (position) =>
      root.render(
        createElement(OpenProgressMap, {
          active: true,
          animated: true,
          cinematic: false,
          fitForPrint: false,
          lifecycle,
          position,
          progress: {},
          showLegend: true,
          workspace: {},
        }),
      );
    window.unmount = () => root.unmount();
    window.update(0);
  });
  await page.waitForFunction(() => window.events.length === 1);
  await page.evaluate(() => window.update(1));
  await page.waitForFunction(() => window.events.length >= 2);
  assert.deepEqual(await page.evaluate(() => window.events), [
    ['present', 0],
    ['present', 1],
  ]);
  await page.evaluate(() => window.unmount());
  assert.deepEqual(await page.evaluate(() => window.events), [
    ['present', 0],
    ['present', 1],
    ['hidden', 1],
  ]);
});

test('React commits the print presentation before map readiness and preserves it until afterprint', async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: progressBrowserScript });
  await page.evaluate(() => {
    const { createElement } = window.fixtureRequire('react');
    const { createRoot } = window.fixtureRequire('react-dom/client');
    const { WorkspaceProgressMap } = window.fixtureRequire('OpenProgressMap');
    const { useOutreachProgress } = window.fixtureRequire('useOutreachProgress');
    const coverage = {
      asOf: '2026-08-02',
      apartmentComplexes: [],
      segments: [
        {
          id: '1',
          streetName: 'Main',
          roadGroupId: 'main',
          estimatedHomes: 10,
          geometry: {
            type: 'LineString',
            coordinates: [
              [0, 0],
              [0.1, 0.1],
            ],
          },
          roots: [{ effectiveCoveredOn: '2026-02-20', packetId: 'packet' }],
        },
      ],
    };
    let presented;
    window.events = [];
    window.print = () => window.events.push('print');
    const lifecycle = {
      present(value) {
        presented = value;
        return () => {};
      },
      whenSettled() {
        window.events.push(
          `waiting:${presented.fitForPrint}:${document.querySelector('#stage').className}`,
        );
        return new Promise((resolve) => {
          window.settled = resolve;
        });
      },
    };
    function App() {
      const { workflow, displayMode, act } = useOutreachProgress({
        active: true,
        coverage,
        camera: { center: [1, 2], zoom: 13 },
        lifecycle,
        onCameraChange: (camera) => window.events.push(['restored', camera]),
      });
      window.act = act;
      return createElement(
        'div',
        { id: 'stage', className: displayMode },
        createElement(WorkspaceProgressMap, {
          active: true,
          lifecycle,
          workflow,
          workspace: coverage,
        }),
      );
    }
    createRoot(document.querySelector('#root')).render(
      createElement(window.fixtureRequire('react').StrictMode, null, createElement(App)),
    );
  });
  await page.waitForFunction(() => Boolean(window.act));
  await page.evaluate(() => {
    void window.act({ kind: 'print' });
  });
  await page.waitForFunction(() => Boolean(window.settled));
  assert.deepEqual(await page.evaluate(() => window.events), ['waiting:true:print']);
  await page.evaluate(() => window.settled());
  await page.waitForFunction(() => window.events.includes('print'));
  assert.equal(await page.locator('#stage').getAttribute('class'), 'print');
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await page.waitForFunction(() => document.querySelector('#stage').className === 'admin');
  assert.deepEqual(await page.evaluate(() => window.events.at(-1)), [
    'restored',
    { center: [1, 2], zoom: 13 },
  ]);
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

test('progress animation updates its map without rerendering the workspace shell', async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: progressBrowserScript });
  await page.evaluate(() => {
    const { createElement } = window.fixtureRequire('react');
    const { createRoot } = window.fixtureRequire('react-dom/client');
    const { WorkspaceProgressMap } = window.fixtureRequire('OpenProgressMap');
    const { useOutreachProgress } = window.fixtureRequire('useOutreachProgress');
    const frames = new Map();
    let frameId = 0;
    window.requestAnimationFrame = (callback) => {
      frames.set(++frameId, callback);
      return frameId;
    };
    window.cancelAnimationFrame = (id) => frames.delete(id);
    window.advance = (time) => {
      const callbacks = [...frames.values()];
      frames.clear();
      for (const callback of callbacks) callback(time);
    };
    const coverage = {
      asOf: '2026-08-02',
      apartmentComplexes: [],
      segments: [
        {
          id: '1',
          streetName: 'Main',
          roadGroupId: 'main',
          estimatedHomes: 10,
          geometry: {
            type: 'LineString',
            coordinates: [
              [0, 0],
              [0.1, 0.1],
            ],
          },
          roots: [{ effectiveCoveredOn: '2026-02-20', packetId: 'packet' }],
        },
      ],
    };
    const lifecycle = {
      present(value) {
        window.position = value.position;
        return () => {};
      },
    };
    window.shellRenders = 0;
    function App() {
      window.shellRenders += 1;
      const { workflow, act, displayMode } = useOutreachProgress({
        active: true,
        coverage,
        camera: { center: [1, 2], zoom: 13 },
        lifecycle,
        onCameraChange() {},
      });
      window.act = act;
      return createElement(
        'div',
        { className: displayMode },
        createElement(WorkspaceProgressMap, {
          active: true,
          lifecycle,
          workflow,
          workspace: coverage,
        }),
      );
    }
    createRoot(document.querySelector('#root')).render(createElement(App));
  });
  await page.waitForFunction(() => window.position === 1);
  const renders = await page.evaluate(() => window.shellRenders);
  await page.evaluate(() => {
    void window.act({ kind: 'play' });
  });
  await page.waitForFunction(() => window.position === 0);
  await page.evaluate(() => {
    window.advance(0);
    window.advance(40);
  });
  await page.waitForFunction(() => window.position > 0 && window.position < 1);
  assert.equal(await page.evaluate(() => window.shellRenders), renders);
  await page.evaluate(() => {
    void window.act({ kind: 'exit' });
  });
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
