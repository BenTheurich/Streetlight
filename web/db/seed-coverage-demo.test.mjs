import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { countEligibleHomesByCoverageClass } from '../lib/coverage.ts';
import { getCoverageWorkspace } from '../lib/coverage-persistence.ts';
import { withTemeculaWorkspace } from '../test/workspace-fixtures.ts';
import { migrateDatabase, openDatabase } from './migrate.mjs';
import { seedDatabase } from './seed.mjs';

test('coverage demo recreates only its isolated database with stable representative review data', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-coverage-demo-'));
  const filename = path.join(directory, 'coverage-demo.db');
  const asOf = '2026-07-28';
  try {
    const { seedCoverageDemo } = await import('./seed-coverage-demo.mjs');
    assert.throws(
      () => seedCoverageDemo(path.join(directory, 'not-the-demo.db'), asOf),
      /must be named coverage-demo\.db/,
    );
    seedCoverageDemo(filename, asOf);
    const first = openDatabase(filename);
    const firstCounts = ['coverage_events', 'batches', 'packets', 'packet_segments'].map(
      (table) => first.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
    );
    first.close();

    const workspace = withTemeculaWorkspace(() => getCoverageWorkspace(filename, asOf));
    assert.equal(workspace.dataMode, 'demo');
    assert.deepEqual(
      [...new Set(workspace.segments.map((segment) => segment.coverageClass))].sort(),
      ['green', 'orange', 'red', 'yellow'],
    );
    assert.equal(
      workspace.segments.filter((segment) => segment.lastCoveredOn === null).length >= 2,
      true,
    );
    assert.equal(workspace.activePackets, 1);
    assert.deepEqual(countEligibleHomesByCoverageClass(workspace.segments), {
      green: 21,
      yellow: 6,
      orange: 1,
      red: workspace.totals.eligibleHomes - 28,
    });
    const corrected = workspace.segments
      .flatMap((segment) => segment.roots)
      .find((root) => root.eventId === 'coverage-demo-corrected-root');
    const voided = workspace.segments
      .flatMap((segment) => segment.roots)
      .find((root) => root.eventId === 'coverage-demo-voided-root');
    assert.deepEqual(corrected, {
      eventId: 'coverage-demo-corrected-root',
      packetId: null,
      originalCoveredOn: '2025-03-15',
      effectiveCoveredOn: '2026-07-08',
      corrections: [
        {
          id: 'coverage-demo-corrected-date',
          sequence: 6,
          coveredOn: '2026-07-08',
          isVoid: false,
        },
      ],
    });
    assert.deepEqual(
      voided?.corrections.map(({ id, coveredOn, isVoid }) => ({ id, coveredOn, isVoid })),
      [{ id: 'coverage-demo-voided-undo', coveredOn: '2025-03-15', isVoid: true }],
    );
    assert.equal(voided?.effectiveCoveredOn, null);

    seedCoverageDemo(filename, asOf);
    const second = openDatabase(filename);
    assert.deepEqual(
      ['coverage_events', 'batches', 'packets', 'packet_segments'].map(
        (table) => second.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
      ),
      firstCounts,
    );
    second.close();

    const founderFilename = path.join(directory, 'streetlight.db');
    const founder = openDatabase(founderFilename);
    migrateDatabase(founder);
    seedDatabase(founder);
    assert.deepEqual(
      ['coverage_events', 'batches', 'packets', 'packet_segments'].map(
        (table) => founder.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
      ),
      [0, 0, 0, 0],
    );
    founder.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('coverage demo can copy the full empty-history territory into geographic age bands', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-full-coverage-demo-'));
  const sourceFilename = path.join(directory, 'streetlight.db');
  const demoFilename = path.join(directory, 'coverage-demo.db');
  const asOf = '2026-07-28';
  try {
    const source = openDatabase(sourceFilename);
    migrateDatabase(source);
    seedDatabase(source);
    source.prepare('UPDATE territories SET name = ?').run('Full territory source');
    source.close();
    const sourceBefore = readFileSync(sourceFilename);

    const { seedCoverageDemo } = await import('./seed-coverage-demo.mjs');
    seedCoverageDemo(demoFilename, asOf, sourceFilename);

    assert.deepEqual(readFileSync(sourceFilename), sourceBefore);
    const demo = openDatabase(demoFilename);
    const copiedName = demo.prepare('SELECT name FROM territories').get().name;
    const eventCount = demo.prepare('SELECT COUNT(*) AS count FROM coverage_events').get().count;
    const unlinkedDemoEvents = demo
      .prepare(
        `SELECT COUNT(*) AS count FROM coverage_events
        WHERE id LIKE 'coverage-demo-band-%' AND packet_id IS NULL`,
      )
      .get().count;
    demo.close();
    assert.equal(copiedName, 'Full territory source');
    assert.equal(eventCount > 20, true);
    assert.equal(unlinkedDemoEvents, 0);

    const workspace = withTemeculaWorkspace(() => getCoverageWorkspace(demoFilename, asOf));
    assert.equal(workspace.dataMode, 'demo');
    assert.deepEqual(
      [...new Set(workspace.segments.map((segment) => segment.coverageClass))].sort(),
      ['green', 'orange', 'red', 'yellow'],
    );
    assert.equal(
      workspace.segments.some((segment) => segment.lastCoveredOn === null),
      true,
    );
    assert.deepEqual(
      [
        ...new Set(
          workspace.segments
            .map((segment) => segment.lastCoveredOn)
            .filter((coveredOn) => coveredOn !== null),
        ),
      ].sort(),
      ['2025-03-15', '2025-11-30', '2026-03-30', '2026-06-28'],
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('coverage demo preserves source history and adds bands only to untouched streets', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-covered-demo-source-'));
  const sourceFilename = path.join(directory, 'streetlight.db');
  const demoFilename = path.join(directory, 'coverage-demo.db');
  try {
    const source = openDatabase(sourceFilename);
    migrateDatabase(source);
    seedDatabase(source);
    const segment = source.prepare('SELECT id FROM street_segments ORDER BY id LIMIT 1').get();
    source
      .prepare(
        `INSERT INTO coverage_events
          (id, church_id, street_segment_id, covered_on, kind, corrects_event_id, is_void)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('real-history', 'church-temecula-pilot', segment.id, '2026-07-01', 'completed', null, 0);
    source.close();
    const sourceBefore = readFileSync(sourceFilename);

    const { seedCoverageDemo } = await import('./seed-coverage-demo.mjs');
    seedCoverageDemo(demoFilename, '2026-07-28', sourceFilename);

    assert.deepEqual(readFileSync(sourceFilename), sourceBefore);
    const demo = openDatabase(demoFilename);
    assert.equal(
      demo.prepare('SELECT COUNT(*) AS count FROM coverage_events').get().count > 1,
      true,
    );
    assert.equal(
      demo
        .prepare('SELECT COUNT(*) AS count FROM coverage_events WHERE street_segment_id = ?')
        .get(segment.id).count,
      1,
    );
    demo.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('coverage demo CLI seeds an explicit guarded path and preserves a rejected target', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-coverage-demo-cli-'));
  const filename = path.join(directory, 'coverage-demo.db');
  const rejected = path.join(directory, 'not-the-demo.db');
  const command = path.join(import.meta.dirname, 'seed-coverage-demo.mjs');
  try {
    for (let run = 0; run < 2; run += 1) {
      const result = spawnSync(process.execPath, [command, filename], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      const database = openDatabase(filename);
      assert.deepEqual(
        ['coverage_events', 'batches', 'packets', 'packet_segments'].map(
          (table) => database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
        ),
        [8, 1, 1, 1],
      );
      database.close();
    }

    writeFileSync(rejected, 'do not delete');
    const result = spawnSync(process.execPath, [command, rejected], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /must be named coverage-demo\.db/);
    assert.equal(readFileSync(rejected, 'utf8'), 'do not delete');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
