import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { migrateDatabase, openDatabase } from './migrate.mjs';

const churchId = 'church-temecula-pilot';
const territoryId = 'territory-temecula-pilot';
const weeks = 52;
const millisecondsPerDay = 24 * 60 * 60 * 1000;
const earthRadiusMiles = 3958.7613;
const defaultDemoPath = path.join(import.meta.dirname, '..', 'data', 'outreach-progress-demo.db');
const canonicalPath = path.join(import.meta.dirname, '..', 'data', 'streetlight.db');
const coverageDeleteGuard = `CREATE TRIGGER coverage_events_no_delete
  BEFORE DELETE ON coverage_events
  BEGIN
    SELECT RAISE(ABORT, 'coverage_events are append-only');
  END`;

function shiftDate(date, days) {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * millisecondsPerDay)
    .toISOString()
    .slice(0, 10);
}

function utcDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid demo as-of date');
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error('Invalid demo as-of date');
  }
}

function resolveDemoPath(filename = defaultDemoPath) {
  const resolved = path.resolve(filename);
  if (path.basename(resolved) !== 'outreach-progress-demo.db') {
    throw new Error('Outreach progress demo target must be named outreach-progress-demo.db');
  }
  return resolved;
}

function geometryDistanceSquared(geometryJson, center) {
  const coordinates = JSON.parse(geometryJson).coordinates;
  const midpoint = coordinates[Math.floor(coordinates.length / 2)];
  const longitudeScale = Math.cos((center.latitude * Math.PI) / 180);
  const longitudeDelta = (midpoint[0] - center.longitude) * longitudeScale;
  const latitudeDelta = midpoint[1] - center.latitude;
  return longitudeDelta * longitudeDelta + latitudeDelta * latitudeDelta;
}

function geometryInsideCircle(geometryJson, center) {
  const coordinates = JSON.parse(geometryJson).coordinates;
  const radiusMiles = center.radius_meters / 1609.344;
  return coordinates.every(([longitude, latitude]) => {
    const toRadians = Math.PI / 180;
    const latitudeDelta = (center.latitude - latitude) * toRadians;
    const longitudeDelta = (center.longitude - longitude) * toRadians;
    const firstLatitude = latitude * toRadians;
    const secondLatitude = center.latitude * toRadians;
    const haversine =
      Math.sin(latitudeDelta / 2) ** 2 +
      Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(longitudeDelta / 2) ** 2;
    return 2 * earthRadiusMiles * Math.asin(Math.sqrt(haversine)) <= radiusMiles;
  });
}

function seedOutreachProgressDatabase(database, asOf) {
  const territory = database
    .prepare(
      `SELECT center_latitude AS latitude, center_longitude AS longitude, import_generation,
        radius_meters, boundary_shape
      FROM territories WHERE id = ? AND church_id = ?`,
    )
    .get(territoryId, churchId);
  if (!territory) throw new Error('Temecula pilot territory is missing');
  if (territory.boundary_shape !== 'circle') {
    throw new Error('Outreach progress demo expects the Temecula circle boundary');
  }

  const segments = database
    .prepare(
      `SELECT id, street_name, geometry_geojson, estimated_homes
      FROM street_segments
      WHERE church_id = ? AND territory_id = ? AND is_current = 1
        AND activation_kind <> 'hidden' AND manually_excluded = 0
      ORDER BY id`,
    )
    .all(churchId, territoryId)
    .filter((segment) => geometryInsideCircle(segment.geometry_geojson, territory))
    .map((segment) => ({
      ...segment,
      distance: geometryDistanceSquared(segment.geometry_geojson, territory),
    }))
    .sort((first, second) => first.distance - second.distance || first.id.localeCompare(second.id));
  if (segments.length < weeks) throw new Error('Outreach progress demo needs at least 52 segments');

  const weeklySegments = Array.from({ length: weeks }, () => []);
  for (const [index, segment] of segments.entries()) {
    weeklySegments[Math.min(weeks - 1, Math.floor((index * weeks) / segments.length))].push(
      segment,
    );
  }
  const firstDate = shiftDate(asOf, -(weeks - 1) * 7);
  const insertBatch = database.prepare(
    `INSERT OR IGNORE INTO batches
      (id, church_id, name, status, finalized_at, import_generation)
    VALUES (?, ?, ?, 'reconciled', ?, ?)`,
  );
  const insertPacket = database.prepare(
    `INSERT OR IGNORE INTO packets
      (id, church_id, batch_id, packet_code, start_address, estimated_homes, status,
        sequence_number, packet_kind)
    VALUES (?, ?, ?, ?, ?, ?, 'completed', 0, 'street')`,
  );
  const insertPacketSegment = database.prepare(
    `INSERT OR IGNORE INTO packet_segments
      (church_id, packet_id, street_segment_id, sequence_number)
    VALUES (?, ?, ?, ?)`,
  );
  const insertEvent = database.prepare(
    `INSERT OR IGNORE INTO coverage_events
      (id, church_id, street_segment_id, packet_id, completion_group_id, covered_on,
        kind, corrects_event_id, is_void)
    VALUES (?, ?, ?, ?, ?, ?, 'completed', NULL, 0)`,
  );

  database.exec('BEGIN IMMEDIATE');
  try {
    // This local demo reset is the only code path allowed to replace pilot history.
    database.exec('DROP TRIGGER coverage_events_no_delete');
    database.prepare('DELETE FROM coverage_events WHERE church_id = ?').run(churchId);
    database.prepare('DELETE FROM batches WHERE church_id = ?').run(churchId);
    database.exec(coverageDeleteGuard);
    for (const [week, group] of weeklySegments.entries()) {
      const suffix = String(week + 1).padStart(2, '0');
      const coveredOn = shiftDate(firstDate, week * 7);
      const batchId = `outreach-progress-demo-v2-batch-${suffix}`;
      const packetId = `outreach-progress-demo-v2-packet-${suffix}`;
      insertBatch.run(
        batchId,
        churchId,
        `Weekly outreach demo - ${coveredOn}`,
        `${coveredOn}T12:00:00.000Z`,
        territory.import_generation,
      );
      insertPacket.run(
        packetId,
        churchId,
        batchId,
        `PROGRESS-DEMO-V2-${suffix}`,
        group[0].street_name || 'Demo starting address',
        group.reduce((total, segment) => total + segment.estimated_homes, 0),
      );
      for (const [sequence, segment] of group.entries()) {
        insertPacketSegment.run(churchId, packetId, segment.id, sequence);
        insertEvent.run(
          `outreach-progress-demo-v2-event-${suffix}-${segment.id}`,
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
  return { firstDate, lastDate: asOf, segments: segments.length, weeks };
}

export function seedOutreachProgressDemo(
  filename = defaultDemoPath,
  asOf = new Date().toISOString().slice(0, 10),
  sourceFilename = canonicalPath,
) {
  const target = resolveDemoPath(filename);
  const source = path.resolve(sourceFilename);
  utcDate(asOf);
  if (source === target) throw new Error('Outreach progress demo source and target must differ');
  if (!existsSync(source)) throw new Error('Outreach progress demo source does not exist');

  rmSync(target, { force: true });
  copyFileSync(source, target);
  const database = openDatabase(target);
  try {
    migrateDatabase(database);
    return { target, ...seedOutreachProgressDatabase(database, asOf) };
  } finally {
    database.close();
  }
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
  if (args.length > 1) throw new Error('outreach progress demo accepts one filename or --serve');
  const serving = args[0] === '--serve';
  const result = seedOutreachProgressDemo(serving ? defaultDemoPath : args[0]);
  console.log(
    `Seeded isolated outreach progress demo at ${result.target} with ${result.weeks} weekly dates from ${result.firstDate} through ${result.lastDate} across ${result.segments} segments`,
  );
  if (serving) process.exitCode = await serveDemo(result.target);
}
