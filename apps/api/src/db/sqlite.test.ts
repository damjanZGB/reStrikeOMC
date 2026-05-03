import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations, type Db } from './sqlite.js';

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'restrike-'));
});

afterEach(() => {
  db?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('sqlite wrapper', () => {
  it('opens a database file and applies migrations idempotently', () => {
    db = openDb(join(dir, 'test.db'));
    runMigrations(db);
    runMigrations(db);
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'")
      .get();
    expect(row).toBeDefined();
  });
});
