import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations, type Db } from '../db/sqlite.js';
import { UserRepo } from './users.js';

let db: Db;
let users: UserRepo;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'restrike-'));
  db = openDb(join(dir, 'test.db'));
  runMigrations(db);
  users = new UserRepo(db);
});

afterEach(() => {
  db?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('UserRepo', () => {
  it('reports empty before any user is created', () => {
    expect(users.count()).toBe(0);
  });

  it('creates a user and verifies the password', async () => {
    const u = await users.create('alice', 'correct horse battery staple');
    expect(u.username).toBe('alice');
    expect(u.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await users.verify('alice', 'correct horse battery staple')).toEqual(u);
    expect(await users.verify('alice', 'wrong')).toBeNull();
    expect(await users.verify('nobody', 'x')).toBeNull();
  });

  it('rejects duplicate username', async () => {
    await users.create('alice', 'pw');
    await expect(users.create('alice', 'other')).rejects.toThrow();
  });
});
