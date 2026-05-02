import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations, type Db } from '../db/sqlite.js';
import { deriveKeyFromString } from '../auth/crypto.js';
import { ConnectionRepo } from './repo.js';

let db: Db;
let dir: string;
let repo: ConnectionRepo;
const KEY = deriveKeyFromString('a'.repeat(32));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'restrike-'));
  db = openDb(join(dir, 'test.db'));
  runMigrations(db);
  repo = new ConnectionRepo(db, KEY);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('ConnectionRepo', () => {
  it('creates and lists a connection without password', () => {
    const c = repo.create({ name: 'A', host: '1.2.3.4', port: 4455 });
    expect(c.hasPassword).toBe(false);
    expect(repo.list()).toEqual([c]);
  });

  it('stores and retrieves an encrypted password', () => {
    const c = repo.create({ name: 'A', host: 'h', port: 4455, password: 'secret' });
    expect(c.hasPassword).toBe(true);
    expect(repo.getPassword(c.id)).toBe('secret');
    expect(repo.list()[0]).not.toHaveProperty('password');
  });

  it('updates and deletes', () => {
    const c = repo.create({ name: 'A', host: 'h', port: 4455 });
    const upd = repo.update(c.id, { name: 'B' });
    expect(upd?.name).toBe('B');
    expect(repo.delete(c.id)).toBe(true);
    expect(repo.list()).toEqual([]);
  });

  it('returns null for missing password', () => {
    const c = repo.create({ name: 'A', host: 'h', port: 4455 });
    expect(repo.getPassword(c.id)).toBeNull();
  });
});
