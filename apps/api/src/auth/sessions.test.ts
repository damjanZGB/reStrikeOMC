import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations, type Db } from '../db/sqlite.js';
import { UserRepo } from './users.js';
import { SessionRepo, SESSION_TTL_MS } from './sessions.js';

let db: Db;
let dir: string;
let users: UserRepo;
let sessions: SessionRepo;
let userId: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'restrike-'));
  db = openDb(join(dir, 'test.db'));
  runMigrations(db);
  users = new UserRepo(db);
  sessions = new SessionRepo(db);
  userId = (await users.create('alice', 'pw')).id;
});

describe('SessionRepo', () => {
  it('creates and validates a session', () => {
    const s = sessions.create(userId);
    expect(sessions.findValid(s.id)?.userId).toBe(userId);
  });

  it('rejects an unknown session id', () => {
    expect(sessions.findValid('nope')).toBeNull();
  });

  it('rejects an expired session', () => {
    const s = sessions.create(userId);
    db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(Date.now() - 1, s.id);
    expect(sessions.findValid(s.id)).toBeNull();
  });

  it('destroys a session', () => {
    const s = sessions.create(userId);
    sessions.destroy(s.id);
    expect(sessions.findValid(s.id)).toBeNull();
  });

  it('purges expired sessions', () => {
    const s = sessions.create(userId);
    db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(Date.now() - 1, s.id);
    expect(sessions.purgeExpired()).toBe(1);
    expect(sessions.findValid(s.id)).toBeNull();
  });

  it('default TTL is 24 hours', () => {
    expect(SESSION_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });
});
