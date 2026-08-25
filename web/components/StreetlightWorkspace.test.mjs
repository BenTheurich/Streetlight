import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';

test('the workspace uses one branded header without a duplicate current-tool label', () => {
  const source = readFileSync(new URL('./StreetlightWorkspace.tsx', import.meta.url), 'utf8');

  assert.match(source, /landing\/streetlight-logo-mark-v2\.webp/);
  assert.doesNotMatch(source, /phase-label/);
  assert.match(source, /aria-label="Administrator tools"/);
});

test('tool sidebars begin with task content instead of repeating the selected tool name', () => {
  for (const filename of [
    './CoverageDashboard.tsx',
    './PacketGenerator.tsx',
    './ReconciliationTool.tsx',
    './StreetlightWorkspace.tsx',
  ]) {
    const source = readFileSync(new URL(filename, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /sidebar-title/);
  }
});

test('coverage makes the current outreach continuation explicit without hiding other tools', () => {
  const source = readFileSync(new URL('./CoverageDashboard.tsx', import.meta.url), 'utf8');

  assert.match(source, />Current work</);
  assert.match(source, /onOpenPackets/);
  assert.match(source, /onOpenReconciliation/);
});

test('the four top-level tools keep packet and setup workflows together', () => {
  const source = readFileSync(new URL('./StreetlightWorkspace.tsx', import.meta.url), 'utf8');

  assert.match(source, /label: 'Packets'/);
  assert.match(source, /label: 'Outreach progress'/);
  assert.match(source, /label: 'Setup'/);
  assert.doesNotMatch(source, /id: 'reconciliation'/);
  assert.match(source, /setPacketView\('reconcile'\);\s*openTool\('packets'\)/);
  assert.match(source, /<PrintoutSettings/);
  assert.match(source, /<OutreachProgress/);
});

test('the MVP keeps apartments behind one disabled product capability', () => {
  const capability = readFileSync(
    new URL('../lib/product-capabilities.ts', import.meta.url),
    'utf8',
  );
  const settings = readFileSync(new URL('./HeatmapSettingsOverlay.tsx', import.meta.url), 'utf8');
  const progress = readFileSync(new URL('./OutreachProgress.tsx', import.meta.url), 'utf8');
  const packets = readFileSync(new URL('./PacketGenerator.tsx', import.meta.url), 'utf8');
  const importRoute = readFileSync(
    new URL('../app/api/territory/import/route.ts', import.meta.url),
    'utf8',
  );

  assert.match(capability, /export const APARTMENTS_ENABLED = false/);
  assert.match(settings, /APARTMENTS_ENABLED && \(/);
  assert.match(progress, /APARTMENTS_ENABLED && \(/);
  assert.match(packets, /APARTMENTS_ENABLED \? ' and apartment complexes' : ''/);
  assert.match(importRoute, /workspace: workspace \? applyMvpCapabilities\(workspace\) : null/);
});

test('the shared coverage map expands apartment clusters and removes its click handler', () => {
  const source = readFileSync(new URL('./OpenCoverageMap.tsx', import.meta.url), 'utf8');

  assert.match(source, /expandApartmentCluster\(/);
  assert.match(source, /map\.on\('click', 'streetlight-apartment-clusters', expand\)/);
  assert.match(source, /map\.off\('click', 'streetlight-apartment-clusters', expand\)/);
});

test('map display and heatmap ranges are edited from the shared legend', () => {
  const workspace = readFileSync(new URL('./StreetlightWorkspace.tsx', import.meta.url), 'utf8');
  const map = readFileSync(new URL('./OpenCoverageMap.tsx', import.meta.url), 'utf8');
  const dashboard = readFileSync(new URL('./CoverageDashboard.tsx', import.meta.url), 'utf8');
  const settings = readFileSync(new URL('./HeatmapSettingsOverlay.tsx', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

  assert.match(map, /aria-label="Open map settings"/);
  assert.match(map, /<circle cx="12" cy="12" r="3"/);
  assert.match(workspace, /<HeatmapSettingsOverlay/);
  assert.doesNotMatch(dashboard, /Heatmap ranges/);
  assert.match(settings, /days since last outreach/);
  assert.doesNotMatch(settings, /Choose how long a street waits/);
  assert.match(workspace, /showApartmentMarkers={showApartmentMarkers}/);
  assert.match(workspace, /localStorage\.setItem\(apartmentMarkerPreferenceKey/);
  assert.match(settings, /className="heatmap-settings-backdrop"/);
  assert.match(settings, /Show apartment markers/);
  assert.match(settings, /role="switch"/);
  assert.match(settings, /aria-label="Dismiss map settings"/);
  assert.match(styles, /\.heatmap-settings-form input\[type="number"\]::-webkit-inner-spin-button/);
  assert.match(styles, /width: min\(100%, 390px\)/);
});

test('proposal rows expand and collapse inline without a separate show-all control', () => {
  const source = readFileSync(new URL('./PacketGenerator.tsx', import.meta.url), 'utf8');

  assert.match(source, /onSelectedIndexChange\(selected \? null : index\)/);
  assert.match(source, /aria-label={`Delete Packet \$\{index \+ 1\} proposal`}/);
  assert.match(source, /aria-label={`Remove packet size \$\{index \+ 1\}`}/);
  assert.doesNotMatch(source, />\s*Remove\s*</);
  assert.match(source, /function deleteProposal[\s\S]*onSelectedIndexChange\(null\)/);
  assert.doesNotMatch(source, /selectedIndex > index/);
  assert.match(source, /proposalIndexes: result\.proposalIndexes/);
  assert.doesNotMatch(source, />\s*Show all\s*</);
  assert.match(source, /!finalized && result\.proposals\.length > 0/);
});

test('packet finalization confirmation moves focus in and returns it on cancel', () => {
  const source = readFileSync(new URL('./PacketGenerator.tsx', import.meta.url), 'utf8');

  assert.match(source, /if \(confirming\) confirmFinalizationRef\.current\?\.focus\(\)/);
  assert.match(source, /finalizationTriggerRef\.current\?\.focus\(\)/);
  assert.match(source, /ref={confirmFinalizationRef}/);
  assert.match(source, /ref={finalizationTriggerRef}/);
});

test('one packet operation lock owns every mutation and PDF entry point', () => {
  const source = readFileSync(new URL('./PacketGenerator.tsx', import.meta.url), 'utf8');

  assert.match(source, /const packetOperationBusy = packetRequestControlsDisabled/);
  assert.equal(source.match(/disabled={packetOperationBusy}/g)?.length, 11);
  assert.match(source, /disabled={packetOperationBusy \|\| activePackets === 0}/);
  assert.equal(source.match(/if \(packetOperationBusy\) return;/g)?.length, 3);
});

test('Setup disclosure controls stay inside both horizontal clipping edges', async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
  const styles = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8').replace(
    /^@import[^;]+;\s*/,
    '',
  );

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
  const styles = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8').replace(
    /^@import[^;]+;\s*/,
    '',
  );

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

test('workflow surfaces use one atomic operation status without duplicate live copy', () => {
  const packets = readFileSync(new URL('./PacketGenerator.tsx', import.meta.url), 'utf8');
  const reconciliation = readFileSync(new URL('./ReconciliationTool.tsx', import.meta.url), 'utf8');

  assert.match(packets, /<OperationStatus/);
  assert.match(packets, /downloadProgress\.headline/);
  assert.doesNotMatch(packets, /<p aria-live="polite">{notice}<\/p>/);

  assert.match(reconciliation, /<OperationStatus/);
  assert.doesNotMatch(reconciliation, /<p aria-live="polite">{notice}<\/p>/);
});

test('territory editing keeps shared overlays and selects exact segments directly', () => {
  const source = readFileSync(new URL('./OpenTerritoryMap.tsx', import.meta.url), 'utf8');

  assert.match(source, /getSource\('streetlightCoverage'\)/);
  assert.match(source, /selectedIds\.has\(segment\.id\)/);
  assert.match(source, /queryRenderedFeatures\(bounds/);
  assert.match(source, /event\.originalEvent\.shiftKey/);
  assert.match(source, /boxSelectionArmed/);
  assert.match(source, /segmentSelectionBounds/);
  assert.match(source, /map\.fitBounds\(bounds, options\)/);
  assert.doesNotMatch(source, /territory-exclusions|territory-drawing/);
});

test('basemap changes republish the map after the replacement style has committed', () => {
  const source = readFileSync(new URL('./WorkspaceMap.tsx', import.meta.url), 'utf8');

  assert.match(source, /map\.once\('style\.load', republish\)/);
  assert.match(
    source,
    /republish = \(\) => \{\s*frame = requestAnimationFrame\(\(\) => onMapChangeRef\.current\(map\)\)/,
  );
  assert.match(source, /cancelAnimationFrame\(frame\)/);
});

test('reconciliation requires an explicit outcome for every physical sheet', () => {
  const source = readFileSync(new URL('./ReconciliationTool.tsx', import.meta.url), 'utf8');

  assert.match(source, /className="reconciliation-active-picker-heading"/);
  assert.doesNotMatch(source, /Choose one outcome for every packet sheet/);
  assert.match(source, /: 'Choose one outcome'}/);
  assert.match(source, /aria-pressed=\{outcome === value\}/);
  assert.match(source, /disabled=\{!reviewReady \|\| mutationControlsDisabled\}/);
});

test('reconciliation keeps pending outcomes visible and history compact', () => {
  const source = readFileSync(new URL('./ReconciliationTool.tsx', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

  assert.match(source, /All taken/);
  assert.match(source, /All discarded/);
  assert.match(source, /Cancels this packet and returns its streets for future generation/);
  assert.match(source, /className="reconciliation-outcome-summary"/);
  assert.match(source, /const editing = editingPacketId === packet\.id/);
  assert.match(source, /aria-expanded=\{editing\}/);
  assert.match(styles, /\.reconciliation-bulk-actions button \{[^}]*min-height: 44px;/s);
});

test('reconciliation identifies every batch with its saved name and finalized time', () => {
  const source = readFileSync(new URL('./ReconciliationTool.tsx', import.meta.url), 'utf8');

  assert.match(source, /function batchOptionLabel\(batch: ReconciliationBatch\)/);
  assert.match(source, /const automaticPrefix = 'Outreach batch - '/);
  assert.match(source, /dateStyle: 'medium'/);
  assert.match(source, /timeStyle: 'short'/);
  assert.match(source, /\? batchOptionLabel\(candidate\)/);
  assert.match(source, /: historyBatchOptionLabel\(candidate\)/);
});

test('reconciliation highlights the selected batch with the shared light-blue road halo', () => {
  const source = readFileSync(new URL('./OpenReconciliationOverlay.tsx', import.meta.url), 'utf8');

  assert.match(source, /'line-color': '#78a9ff'/);
  assert.match(source, /const haloBefore = map\.getLayer\('streetlight-coverage'\)/);
  assert.match(source, /'line-width': \['interpolate', \['linear'\], \['zoom'\], 11, 10, 14, 13\]/);
  assert.match(source, /const focusKey = `\$\{batch\.id\}:/);
});

test('reconciliation correction status and retry stay with the affected packet', () => {
  const source = readFileSync(new URL('./ReconciliationTool.tsx', import.meta.url), 'utf8');

  assert.match(source, /type CorrectionAttempt =/);
  assert.match(source, /attempt: \{ packetId: packet\.id, coveredOn \}/);
  assert.equal(source.match(/correctionStatus\(packet\)/g)?.length, 2);
  assert.match(source, /void correct\(packet, correctionFeedback\.attempt\.coveredOn\)/);
  assert.doesNotMatch(source, /operation === 'correction'/);
});
