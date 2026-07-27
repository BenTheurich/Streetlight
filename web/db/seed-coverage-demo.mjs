import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { migrateDatabase, openDatabase } from './migrate.mjs';
import { seedDatabase } from './seed.mjs';

const churchId = 'church-temecula-pilot';
const territoryId = 'territory-temecula-pilot';
const defaultDemoPath = path.join(import.meta.dirname, '..', 'data', 'coverage-demo.db');

function utcDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid demo as-of date');
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error('Invalid demo as-of date');
  }
  return date;
}

function daysBefore(asOf, days) {
  const date = utcDate(asOf);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function resolveDemoPath(filename = defaultDemoPath) {
  const resolved = path.resolve(filename);
  if (path.basename(resolved) !== 'coverage-demo.db') {
    throw new Error('Coverage demo target must be named coverage-demo.db');
  }
  return resolved;
}

export function seedCoverageDemo(
  filename = defaultDemoPath,
  asOf = new Date().toISOString().slice(0, 10),
) {
  const target = resolveDemoPath(filename);
  utcDate(asOf);
  rmSync(target, { force: true });
  const database = openDatabase(target);
  try {
    migrateDatabase(database);
    seedDatabase(database);
    const segments = database
      .prepare(
        `SELECT id, estimated_homes FROM street_segments
        WHERE church_id = ? AND territory_id = ? AND is_current = 1 AND estimated_homes > 0
        ORDER BY import_segment_id`,
      )
      .all(churchId, territoryId);
    if (segments.length < 7) throw new Error('Coverage demo needs seven residential segments');
    const insertEvent = database.prepare(
      `INSERT INTO coverage_events
        (id, church_id, street_segment_id, covered_on, kind, corrects_event_id, is_void)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    database.exec('BEGIN IMMEDIATE');
    try {
      const [green, yellow, orange, red, , corrected, voided] = segments;
      insertEvent.run(
        'coverage-demo-green-root',
        churchId,
        green.id,
        daysBefore(asOf, 30),
        'completed',
        null,
        0,
      );
      insertEvent.run(
        'coverage-demo-yellow-root',
        churchId,
        yellow.id,
        daysBefore(asOf, 120),
        'completed',
        null,
        0,
      );
      insertEvent.run(
        'coverage-demo-orange-root',
        churchId,
        orange.id,
        daysBefore(asOf, 240),
        'completed',
        null,
        0,
      );
      insertEvent.run(
        'coverage-demo-red-root',
        churchId,
        red.id,
        daysBefore(asOf, 500),
        'completed',
        null,
        0,
      );
      insertEvent.run(
        'coverage-demo-corrected-root',
        churchId,
        corrected.id,
        daysBefore(asOf, 500),
        'completed',
        null,
        0,
      );
      insertEvent.run(
        'coverage-demo-corrected-date',
        churchId,
        corrected.id,
        daysBefore(asOf, 20),
        'correction',
        'coverage-demo-corrected-root',
        0,
      );
      insertEvent.run(
        'coverage-demo-voided-root',
        churchId,
        voided.id,
        daysBefore(asOf, 500),
        'completed',
        null,
        0,
      );
      insertEvent.run(
        'coverage-demo-voided-undo',
        churchId,
        voided.id,
        daysBefore(asOf, 500),
        'correction',
        'coverage-demo-voided-root',
        1,
      );
      database
        .prepare(
          'INSERT INTO batches (id, church_id, name, status, finalized_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(
          'coverage-demo-batch',
          churchId,
          'Coverage dashboard review',
          'finalized',
          `${asOf}T12:00:00.000Z`,
        );
      database
        .prepare(
          `INSERT INTO packets
            (id, church_id, batch_id, packet_code, start_address, estimated_homes, status)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'coverage-demo-packet',
          churchId,
          'coverage-demo-batch',
          'COVERAGE-DEMO-001',
          'Demo starting address',
          green.estimated_homes,
          'active',
        );
      database
        .prepare(
          `INSERT INTO packet_segments (church_id, packet_id, street_segment_id, sequence_number)
          VALUES (?, ?, ?, ?)`,
        )
        .run(churchId, 'coverage-demo-packet', green.id, 0);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  } finally {
    database.close();
  }
  return target;
}

function serveDemo(target) {
  const nextCli = path.join(
    import.meta.dirname,
    '..',
    'node_modules',
    'next',
    'dist',
    'bin',
    'next',
  );
  const child = spawn(process.execPath, [nextCli, 'dev', '-p', '3001'], {
    cwd: path.join(import.meta.dirname, '..'),
    env: { ...process.env, STREETLIGHT_DATABASE_PATH: target },
    stdio: 'inherit',
  });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
}

const isCommand =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href ===
    pathToFileURL(fileURLToPath(import.meta.url)).href;

if (isCommand) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--serve')) {
    throw new Error('coverage demo accepts only --serve');
  }
  const target = seedCoverageDemo();
  console.log(`Seeded isolated coverage demo at ${target}`);
  if (args[0] === '--serve') process.exitCode = await serveDemo(target);
}
