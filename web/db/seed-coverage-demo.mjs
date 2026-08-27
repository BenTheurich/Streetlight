import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { migrateDatabase, openDatabase } from './migrate.mjs';
import { seedDatabase } from './seed.mjs';

const churchId = 'church-temecula-pilot';
const territoryId = 'territory-temecula-pilot';
const defaultDemoPath = path.join(import.meta.dirname, '..', 'data', 'coverage-demo.db');
const canonicalPath = path.join(import.meta.dirname, '..', 'data', 'streetlight.db');

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

function geometryDistanceSquared(geometryJson, center) {
  const geometry = JSON.parse(geometryJson);
  if (
    geometry?.type !== 'LineString' ||
    !Array.isArray(geometry.coordinates) ||
    geometry.coordinates.length < 2
  ) {
    throw new Error('Invalid demo segment geometry');
  }
  const [longitude, latitude] = geometry.coordinates.reduce(
    ([longitudeTotal, latitudeTotal], coordinate) => [
      longitudeTotal + coordinate[0],
      latitudeTotal + coordinate[1],
    ],
    [0, 0],
  );
  const longitudeScale = Math.cos((center.latitude * Math.PI) / 180);
  const longitudeDelta =
    (longitude / geometry.coordinates.length - center.longitude) * longitudeScale;
  const latitudeDelta = latitude / geometry.coordinates.length - center.latitude;
  return longitudeDelta * longitudeDelta + latitudeDelta * latitudeDelta;
}

function seedFullTerritoryDemo(target, sourceFilename, asOf) {
  const source = path.resolve(sourceFilename);
  if (source === target) throw new Error('Coverage demo source and target must differ');
  if (!existsSync(source)) throw new Error('Coverage demo source does not exist');

  rmSync(target, { force: true });
  copyFileSync(source, target);
  const database = openDatabase(target);
  try {
    migrateDatabase(database);
    const center = database
      .prepare(
        `SELECT center_latitude AS latitude, center_longitude AS longitude, import_generation
        FROM territories WHERE id = ? AND church_id = ?`,
      )
      .get(territoryId, churchId);
    if (!center) throw new Error('Coverage demo territory is missing');
    const segments = database
      .prepare(
        `SELECT segment.id, segment.geometry_geojson, segment.road_group_id,
          segment.street_name, segment.estimated_homes
        FROM street_segments AS segment
        WHERE segment.church_id = ? AND segment.territory_id = ? AND segment.is_current = 1
          AND segment.activation_kind <> 'hidden'
          AND NOT EXISTS (
            SELECT 1 FROM coverage_events AS event
            WHERE event.church_id = segment.church_id
              AND event.street_segment_id = segment.id
          )
        ORDER BY segment.id`,
      )
      .all(churchId, territoryId)
      .map((segment) => ({
        ...segment,
        distance: geometryDistanceSquared(segment.geometry_geojson, center),
      }))
      .sort(
        (first, second) => first.distance - second.distance || first.id.localeCompare(second.id),
      );
    if (segments.length < 4) throw new Error('Coverage demo needs four active segments');

    const coveredSegments = segments.flatMap((segment, index) => {
      const position = index / segments.length;
      const age =
        position < 0.2
          ? 30
          : position < 0.4
            ? 120
            : position < 0.6
              ? 240
              : position < 0.7
                ? 500
                : null;
      return age === null ? [] : [{ ...segment, index, coveredOn: daysBefore(asOf, age) }];
    });
    const packetGroups = new Map();
    for (const segment of coveredSegments) {
      const key = `${segment.coveredOn}:${segment.road_group_id ?? segment.id}`;
      const group = packetGroups.get(key);
      if (group) group.push(segment);
      else packetGroups.set(key, [segment]);
    }
    const insertBatch = database.prepare(
      `INSERT INTO batches
        (id, church_id, name, status, finalized_at, import_generation)
      VALUES (?, ?, ?, 'reconciled', ?, ?)`,
    );
    const insertPacket = database.prepare(
      `INSERT INTO packets
        (id, church_id, batch_id, packet_code, start_address, estimated_homes, status,
          sequence_number, packet_kind)
      VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, 'street')`,
    );
    const insertPacketSegment = database.prepare(
      `INSERT INTO packet_segments
        (church_id, packet_id, street_segment_id, sequence_number)
      VALUES (?, ?, ?, ?)`,
    );
    const insertEvent = database.prepare(
      `INSERT INTO coverage_events
        (id, church_id, street_segment_id, packet_id, completion_group_id, covered_on,
          kind, corrects_event_id, is_void)
      VALUES (?, ?, ?, ?, ?, ?, 'completed', NULL, 0)`,
    );
    const batchSequences = new Map();
    database.exec('BEGIN IMMEDIATE');
    try {
      for (const [groupIndex, group] of [...packetGroups.values()].entries()) {
        const coveredOn = group[0].coveredOn;
        const batchId = `coverage-demo-history-${coveredOn}`;
        if (!batchSequences.has(batchId)) {
          insertBatch.run(
            batchId,
            churchId,
            `Demo outreach - ${coveredOn}`,
            `${coveredOn}T12:00:00.000Z`,
            center.import_generation,
          );
          batchSequences.set(batchId, 0);
        }
        const packetId = `coverage-demo-history-packet-${String(groupIndex).padStart(5, '0')}`;
        const batchSequence = batchSequences.get(batchId);
        insertPacket.run(
          packetId,
          churchId,
          batchId,
          `COVERAGE-DEMO-${String(groupIndex).padStart(5, '0')}`,
          group[0].street_name || 'Demo starting address',
          group.reduce((total, segment) => total + segment.estimated_homes, 0),
          batchSequence,
        );
        batchSequences.set(batchId, batchSequence + 1);
        for (const [sequence, segment] of group.entries()) {
          insertPacketSegment.run(churchId, packetId, segment.id, sequence);
          insertEvent.run(
            `coverage-demo-band-${String(segment.index).padStart(5, '0')}`,
            churchId,
            segment.id,
            packetId,
            `${packetId}-completion`,
            coveredOn,
          );
        }
      }
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  } finally {
    database.close();
  }
}

export function seedCoverageDemo(
  filename = defaultDemoPath,
  asOf = new Date().toISOString().slice(0, 10),
  sourceFilename,
) {
  const target = resolveDemoPath(filename);
  utcDate(asOf);
  if (sourceFilename) {
    seedFullTerritoryDemo(target, sourceFilename, asOf);
    return target;
  }
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
  if (args.length > 1) {
    throw new Error('coverage demo accepts one filename or --serve');
  }
  const serving = args[0] === '--serve';
  const target = seedCoverageDemo(
    serving ? defaultDemoPath : args[0],
    new Date().toISOString().slice(0, 10),
    serving ? canonicalPath : undefined,
  );
  console.log(`Seeded isolated coverage demo at ${target}`);
  if (args[0] === '--serve') process.exitCode = await serveDemo(target);
}
