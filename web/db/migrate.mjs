import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const databasePath = path.join(import.meta.dirname, '..', 'data', 'streetlight.db');
const migrationsPath = path.join(import.meta.dirname, 'migrations');

export function openDatabase(filename = databasePath) {
  if (filename !== ':memory:') {
    mkdirSync(path.dirname(filename), { recursive: true });
  }

  const database = new DatabaseSync(filename);
  database.exec('PRAGMA foreign_keys = ON');
  return database;
}

export function migrateDatabase(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) STRICT
  `);

  const applied = database.prepare('SELECT 1 FROM schema_migrations WHERE name = ?');
  const record = database.prepare('INSERT INTO schema_migrations (name) VALUES (?)');

  for (const name of readdirSync(migrationsPath)
    .filter((file) => file.endsWith('.sql'))
    .sort()) {
    if (applied.get(name)) {
      continue;
    }

    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(readFileSync(path.join(migrationsPath, name), 'utf8'));
      record.run(name);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
}

const isCommand =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href ===
    pathToFileURL(fileURLToPath(import.meta.url)).href;

if (isCommand) {
  const database = openDatabase();
  migrateDatabase(database);
  database.close();
  console.log(`Migrated ${databasePath}`);
}
