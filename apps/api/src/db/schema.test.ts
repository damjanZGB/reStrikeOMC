import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations, type Db } from './sqlite.js';

let db: Db;
let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'restrike-'));
  db = openDb(join(dir, 'test.db'));
  runMigrations(db);
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const expectedTables = ['users', 'connections', 'sessions', 'audit_log'];

describe('initial schema', () => {
  it.each(expectedTables)('table %s exists', (name) => {
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
      .get(name);
    expect(row).toEqual({ name });
  });

  it('users table has expected columns', () => {
    const cols = db.prepare(`PRAGMA table_info(users)`).all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name).sort()).toEqual(
      ['created_at', 'id', 'password_hash', 'username']
    );
  });
});
