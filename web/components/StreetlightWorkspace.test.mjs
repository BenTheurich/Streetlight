import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';

test('new churches see only territory setup until the first save succeeds', () => {
  const source = readFileSync(new URL('./StreetlightWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(source, /setupOnly/);
  assert.match(source, /!setupRequired &&/);
  assert.match(source, /setSetupOnly\(false\)/);
});

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
    './TerritoryEditor.tsx',
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

test('territory church location reuses onboarding place search with a manual fallback', () => {
  const workspace = readFileSync(new URL('./StreetlightWorkspace.tsx', import.meta.url), 'utf8');
  const territory = readFileSync(new URL('./TerritoryEditor.tsx', import.meta.url), 'utf8');

  assert.match(territory, /PlaceAutocompleteElement/);
  assert.match(territory, /Search for your church or address/);
  assert.match(territory, /placeSearchFailed/);
  assert.match(workspace, /mapsApiKey={mapsApiKey}/);
});

test('expanded region settings use flat rows instead of nested cards', () => {
  const territory = readFileSync(new URL('./TerritoryEditor.tsx', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

  assert.equal(territory.match(/className="region-settings-row/g)?.length, 3);
  assert.match(styles, /\.region-settings-row \{[^}]*border-top: 1px solid var\(--line\);/s);
  assert.doesNotMatch(styles, /\.region-settings-disclosure \{[^}]*background:/s);
  assert.doesNotMatch(styles, /\.region-settings-disclosure:not\(\[open\]\)/);
  assert.doesNotMatch(styles, /\.region-settings-disclosure > summary:hover \{[^}]*background:/s);
  assert.match(styles, /\.radius-control\.region-settings-row \{[^}]*border-top: 0;/s);
});

test('territory review coordinates dense sections without a redundant introduction', () => {
  const territory = readFileSync(new URL('./TerritoryEditor.tsx', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

  assert.doesNotMatch(territory, /Review region data/);
  assert.doesNotMatch(territory, /Correct apartment status/);
  assert.match(territory, /const \[openReviewSection, setOpenReviewSection\]/);
  assert.match(territory, /<details\s+className="review-disclosure apartment-section"/);
  assert.match(
    territory,
    /<summary[\s\S]*?Apartments[\s\S]*?apartmentSummary\.siteCount[\s\S]*?'site' : 'sites'[\s\S]*?apartmentSummary\.includedCount[\s\S]*?included[\s\S]*?<\/summary>/,
  );
  assert.doesNotMatch(territory, /apartmentSummary\.ungrouped.*building/s);
  assert.match(territory, /const \[apartmentSearch, setApartmentSearch\]/);
  assert.match(territory, /apartmentReviewOptions\(/);
  assert.match(territory, /Find an apartment site/);
  assert.match(territory, /className="apartment-search-results"/);
  assert.doesNotMatch(territory, /<StreetlightSelect[\s\S]*?ariaLabel="Apartment complex"/);
  assert.match(
    territory,
    /<details\s+className="review-disclosure road-selection-section"[\s\S]*open=\{openReviewSection === 'roads'\}/,
  );
  assert.match(territory, /eligibleSegments\.toLocaleString\('en-US'\)/);
  assert.match(territory, /eligibleHomes\.toLocaleString\('en-US'\)/);
  assert.match(territory, /<details\s+className="review-disclosure territory-data-quality"/);
  assert.match(territory, /warnings\.length} warning/);
  assert.match(territory, /Some streets need a quick map review before packet generation/);
  assert.match(territory, /Technical details/);
  assert.doesNotMatch(territory, /inferred road\(s\)/);
  assert.match(territory, /has-pending-changes/);
  assert.match(
    styles,
    /\.review-disclosure-title \{[^}]*font-size: 0\.9rem;[^}]*text-transform: none;/s,
  );
  assert.match(styles, /\.region-settings-summary-copy strong \{[^}]*font-size: 0\.9rem;/s);
  assert.doesNotMatch(styles, /\.review-disclosure\[open\] \.review-disclosure-title/);
  assert.match(styles, /\.review-disclosure-meta \{[^}]*font-size: 0\.72rem;/s);
  assert.match(styles, /\.section-help \{[^}]*font-size: 0\.78rem;/s);
  assert.match(
    styles,
    /\.apartment-card \{[^}]*border: 1px solid var\(--selected\);[^}]*background: var\(--selected-surface\);/s,
  );
  assert.match(styles, /\.road-selection-tray \.text-button \{[^}]*min-height: 44px;/s);
  assert.match(
    styles,
    /\.road-search-results button\[aria-pressed="true"\] \{[^}]*background: var\(--selected-surface\);/s,
  );
  assert.match(styles, /\.apartment-search-results \{/);
  assert.match(
    styles,
    /\.territory-sidebar:not\(\.has-pending-changes\) \.sidebar-actions button:disabled/,
  );
  assert.match(styles, /\.road-selection-tray \{[^}]*position: sticky;[^}]*top:/s);
});

test('territory disclosures animate as joined sections with dividers between them', () => {
  const territory = readFileSync(new URL('./TerritoryEditor.tsx', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

  assert.doesNotMatch(styles, /\.review-disclosure > summary \{[^}]*border-bottom:/s);
  assert.match(styles, /\.territory-review-tools \{[^}]*border-top: 1px solid var\(--line\);/s);
  assert.match(
    styles,
    /\.territory-review-tools > \.review-disclosure \+ \.review-disclosure \{[^}]*border-top: 1px solid var\(--line\);/s,
  );
  assert.match(styles, /\.review-disclosure::details-content[\s\S]*block-size: 0;/);
  assert.match(styles, /\.review-disclosure\[open\]::details-content[\s\S]*block-size: auto;/);
  assert.match(styles, /\.review-disclosure-body \{[^}]*padding: 1rem 0 1\.5rem;/s);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(territory, /const REVIEW_SECTION_CLOSE_MS = 150;/);
  assert.match(territory, /const transitionReviewSection = useCallback/);
  assert.match(
    territory,
    /setOpenReviewSection\(null\);[\s\S]*window\.setTimeout\([\s\S]*REVIEW_SECTION_CLOSE_MS/,
  );
  assert.match(territory, /transitionReviewSection\('roads'\)/);
  assert.match(territory, /transitionReviewSection\('apartments'\)/);
  assert.doesNotMatch(territory, /onToggle=/);
  assert.equal(territory.match(/onKeyDown=\{/g)?.length, 4);
  assert.equal(territory.match(/event\.key === 'Enter' \|\| event\.key === ' '/g)?.length, 4);
});

test('Setup first-pass polish keeps apartment review reversible and road search task-first', () => {
  const territory = readFileSync(new URL('./TerritoryEditor.tsx', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

  assert.match(
    territory,
    /className="reconciliation-back-link"[\s\S]*setApartmentSelection\(null\)[\s\S]*M20 11H7\.83[\s\S]*Back to list[\s\S]*className="apartment-card apartment-site-card"/,
  );
  assert.doesNotMatch(styles, /\.apartment-card-back/);
  assert.match(styles, /\.road-section-tools \{[^}]*justify-content: flex-start;/s);

  const searchIndex = territory.indexOf('className="road-segment-search"');
  const instructionsIndex = territory.indexOf(
    'Search by street name, or select roads directly on the map.',
  );
  const hiddenRoadsIndex = territory.indexOf('className="road-section-tools"');
  assert.ok(searchIndex >= 0 && searchIndex < instructionsIndex);
  assert.ok(instructionsIndex < hiddenRoadsIndex);
});

test('apartment inclusion uses one choice after the three packet facts', () => {
  const territory = readFileSync(new URL('./TerritoryEditor.tsx', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  const databaseImport =
    territory.match(/import \{([\s\S]*?)\} from '@\/lib\/database';/)?.[1] ?? '';

  assert.doesNotMatch(databaseImport, /apartmentSiteReady/);
  assert.match(territory, /Include in packet generation/);
  assert.match(territory, /type="checkbox"/);
  assert.match(territory, /fetch\('\/api\/territory\/apartment'/);
  assert.match(territory, /readMutationResult/);
  assert.match(territory, /optimisticApartmentConfiguration/);
  assert.match(territory, /resolveApartmentMutation/);
  assert.match(territory, /Primary entrance or address/);
  assert.match(territory, /Tract quantity/);
  assert.match(territory, /<option value="open">Open<\/option>/);
  assert.match(territory, /<option value="restricted">Restricted<\/option>/);
  assert.match(territory, /Include in packet generation/);
  assert.match(territory, /Edit buildings/);
  assert.doesNotMatch(territory, /Complex name/);
  assert.doesNotMatch(territory, /Building grouping confirmed/);
  assert.doesNotMatch(territory, /Primary entrance confirmed/);
  assert.doesNotMatch(territory, /Needs setup/);
  assert.doesNotMatch(territory, /Packet ready/);
  assert.match(territory, /Group apartment buildings/);
  assert.match(territory, /method: 'POST'/);
  assert.match(territory, /Try again/);
  assert.match(territory, /Reload to verify/);
  assert.doesNotMatch(
    territory,
    /Outreach status|Needs review|Deferred|estimated tracts|footprint estimate/,
  );
  assert.doesNotMatch(territory, /apartmentStatuses:/);
  assert.match(styles, /\.apartment-inclusion-control \{[^}]*min-height: 44px;/s);
  assert.match(styles, /\.apartment-site-heading > span\.included \{/);
  assert.doesNotMatch(styles, /\.apartment-readiness-checks/);
  assert.match(
    styles,
    /\.apartment-configuration-fields label:first-child \{[^}]*grid-column: 1 \/ -1;/s,
  );
  assert.doesNotMatch(styles, /\.apartment-card fieldset/);
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

test('territory selection and long imports stay in the approved workflow', () => {
  const source = readFileSync(new URL('./TerritoryEditor.tsx', import.meta.url), 'utf8');

  assert.doesNotMatch(source, />\s*Pan\s*</);
  assert.match(source, /placement={operationPlacement}/);
  assert.match(source, /Your saved region remains active/);
  assert.match(source, /!backgroundImportComplete/);
  assert.doesNotMatch(source, /territory-import-banner/);
});

test('territory verification keeps global tool navigation available without unmounting the draft', () => {
  const workspace = readFileSync(new URL('./StreetlightWorkspace.tsx', import.meta.url), 'utf8');
  const territory = readFileSync(new URL('./TerritoryEditor.tsx', import.meta.url), 'utf8');
  const printouts = readFileSync(new URL('./PrintoutSettings.tsx', import.meta.url), 'utf8');

  assert.match(territory, /onImportingChange\(leaveControlsDisabled\)/);
  assert.match(workspace, /territoryDirty && !territorySaving/);
  assert.match(workspace, /setupView === 'printouts' && printoutDirty/);
  assert.match(printouts, /Save printout changes before leaving\?/);
  assert.match(workspace, /\{territory && \(\s*<TerritoryEditor/);
});

test('region footer waits for apartment mutations while preserving its draft gates', () => {
  const territory = readFileSync(new URL('./TerritoryEditor.tsx', import.meta.url), 'utf8');

  assert.match(
    territory,
    /className="secondary"\s+disabled=\{!hasUnsavedChanges \|\| leaveControlsDisabled\}[\s\S]*?>\s*Cancel\s*<\/button>/,
  );
  assert.match(
    territory,
    /disabled=\{!canSave \|\| leaveControlsDisabled \|\| Boolean\(radiusError\)\}[\s\S]*?>[\s\S]*?'Save changes'\}[\s\S]*?<\/button>/,
  );
});

test('apartment recovery stays reachable outside the inert region editor', () => {
  const territory = readFileSync(new URL('./TerritoryEditor.tsx', import.meta.url), 'utf8');
  const scrollStart = territory.indexOf('<div className="sidebar-scroll" inert=');
  const actionsStart = territory.indexOf('<div className="sidebar-actions">');
  const recoveryStart = territory.indexOf('{apartmentSaveFailure && (');
  const regionStatusStart = territory.indexOf("{operationPlacement === 'surface' && saveStatus}");

  assert.ok(scrollStart >= 0 && scrollStart < actionsStart);
  assert.ok(recoveryStart > actionsStart && recoveryStart < regionStatusStart);
  assert.equal(territory.match(/\{apartmentSaveFailure && \(/g)?.length, 1);
  assert.doesNotMatch(territory.slice(scrollStart, actionsStart), /apartmentSaveFailure &&/);
  const recovery = territory.slice(recoveryStart, regionStatusStart);
  assert.match(recovery, /window\.location\.reload\(\)/);
  assert.match(recovery, /Reload to verify/);
  assert.match(recovery, /retryApartmentMutation\(apartmentSaveFailure\)/);
  assert.match(recovery, /Try again/);
});

test('workflow surfaces use one atomic operation status without duplicate live copy', () => {
  const packets = readFileSync(new URL('./PacketGenerator.tsx', import.meta.url), 'utf8');
  const reconciliation = readFileSync(new URL('./ReconciliationTool.tsx', import.meta.url), 'utf8');
  const territory = readFileSync(new URL('./TerritoryEditor.tsx', import.meta.url), 'utf8');

  assert.match(packets, /<OperationStatus/);
  assert.match(packets, /downloadProgress\.headline/);
  assert.doesNotMatch(packets, /<p aria-live="polite">{notice}<\/p>/);

  assert.match(reconciliation, /<OperationStatus/);
  assert.doesNotMatch(reconciliation, /<p aria-live="polite">{notice}<\/p>/);

  assert.match(territory, /<OperationStatus/);
  assert.doesNotMatch(territory, /territory-import-banner/);
});

test('territory editing keeps shared overlays and selects exact segments directly', () => {
  const source = readFileSync(new URL('./OpenTerritoryMap.tsx', import.meta.url), 'utf8');
  const editor = readFileSync(new URL('./TerritoryEditor.tsx', import.meta.url), 'utf8');

  assert.match(source, /getSource\('streetlightCoverage'\)/);
  assert.match(source, /selectedIds\.has\(segment\.id\)/);
  assert.match(source, /queryRenderedFeatures\(bounds/);
  assert.match(source, /event\.originalEvent\.shiftKey/);
  assert.match(source, /boxSelectionArmed/);
  assert.match(editor, /mutationLocked={leaveControlsDisabled}/);
  assert.match(editor, /roadFocusRequest={roadFocusRequest}/);
  assert.match(editor, /coverageRoads/);
  assert.match(editor, /road\.segments\.map\(\(\{ id \}\) => id\)/);
  assert.match(source, /segmentSelectionBounds/);
  assert.match(source, /map\.fitBounds\(bounds, options\)/);
  assert.match(editor, /setSegmentsExcluded/);
  assert.match(editor, /activateSegments/);
  assert.match(editor, /Select road area/);
  assert.match(editor, /Shift-drag selects road segments/);
  assert.match(
    editor,
    /setBoxSelectionArmed\(\(armed\) => !armed\);[\s\S]*transitionReviewSection\('roads'\)/,
  );
  assert.doesNotMatch(source, /territory-exclusions|territory-drawing/);
  assert.doesNotMatch(editor, /Draw exclusion area|finishDrawing|selectedExclusionId/);
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
