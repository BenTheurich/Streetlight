import { existsSync, linkSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

function inspectCopy(database) {
  const integrity = database.prepare('PRAGMA integrity_check').all();
  if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') {
    throw new Error('Database integrity check failed');
  }
  if (database.prepare('PRAGMA foreign_key_check').all().length !== 0) {
    throw new Error('Database foreign-key check failed');
  }
  return Object.fromEntries(
    [
      'schema_migrations',
      'churches',
      'territories',
      'street_segments',
      'batches',
      'packets',
      'packet_segments',
      'coverage_events',
    ].map((table) => [
      table,
      database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
    ]),
  );
}

export async function copyDatabase(sourceFilename, destinationFilename) {
  if (!sourceFilename || !destinationFilename) {
    throw new Error('Explicit source and new destination database paths are required');
  }
  const sourcePath = path.resolve(sourceFilename);
  const destinationPath = path.resolve(destinationFilename);
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    if (existsSync(`${destinationPath}${suffix}`)) {
      throw new Error(`Destination already exists: ${destinationPath}${suffix}`);
    }
  }

  const source = new DatabaseSync(sourcePath, { readOnly: true });
  let directory;
  try {
    directory = mkdtempSync(path.join(path.dirname(destinationPath), '.streetlight-recovery-'));
    const stagedPath = path.join(directory, 'copy.db');
    await backup(source, stagedPath);
    const copy = new DatabaseSync(stagedPath);
    let counts;
    try {
      // Publish a standalone database file even when the source uses WAL.
      copy.exec('PRAGMA journal_mode = DELETE');
      counts = inspectCopy(copy);
    } finally {
      copy.close();
    }
    // A same-filesystem hard link publishes the complete file without replacing any path.
    linkSync(stagedPath, destinationPath);
    return { source: sourcePath, destination: destinationPath, integrity: 'ok', counts };
  } finally {
    source.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const [operation, source, destination, ...extra] = process.argv.slice(2);
  try {
    if (!['backup', 'restore'].includes(operation) || !source || !destination || extra.length) {
      throw new Error('Usage: node db/recovery.mjs <backup|restore> <source.db> <new-copy.db>');
    }
    console.log(
      JSON.stringify({ operation, ...(await copyDatabase(source, destination)) }, null, 2),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
