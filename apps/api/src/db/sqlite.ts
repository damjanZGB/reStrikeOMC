import Database from 'better-sqlite3';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Db = Database.Database;

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  'migrations'
);

export function openDb(path: string): Db {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

export function runMigrations(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const applied = new Set(
    db.prepare<[], { id: string }>('SELECT id FROM _migrations').all().map((r) => r.id)
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const insert = db.prepare('INSERT INTO _migrations (id, applied_at) VALUES (?, ?)');

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      insert.run(file, Date.now());
    })();
  }
}
