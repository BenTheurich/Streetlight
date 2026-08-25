import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function workspaceDatabaseFilename(filename?: string): string {
  return (
    filename ??
    process.env.STREETLIGHT_DATABASE_PATH ??
    path.join(process.cwd(), 'data', 'streetlight.db')
  );
}

export function openSqliteDatabase(filename?: string): DatabaseSync {
  const resolved = workspaceDatabaseFilename(filename);
  if (resolved !== ':memory:') mkdirSync(path.dirname(resolved), { recursive: true });
  const database = new DatabaseSync(resolved);
  database.exec('PRAGMA foreign_keys = ON');
  return database;
}

export function withWorkspaceDatabase<T>(
  filename: string | undefined,
  operation: (database: DatabaseSync) => T,
): T {
  const database = openSqliteDatabase(filename);
  try {
    return operation(database);
  } finally {
    database.close();
  }
}

export function withImmediateTransaction<T>(
  filename: string | undefined,
  operation: (database: DatabaseSync) => T,
): T {
  return withWorkspaceDatabase(filename, (database) => {
    database.exec('BEGIN IMMEDIATE');
    try {
      const result = operation(database);
      database.exec('COMMIT');
      return result;
    } catch (error) {
      if (database.isTransaction) database.exec('ROLLBACK');
      throw error;
    }
  });
}
