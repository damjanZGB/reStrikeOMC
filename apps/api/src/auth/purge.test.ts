import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations, type Db } from '../db/sqlite.js';
import { UserRepo } from './users.js';
import { SessionRepo } from './sessions.js';
import { startSessionPurgeTimer } from './purge.js';

describe('startSessionPurgeTimer', () => {
  let db: Db;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'restrike-'));
    db = openDb(join(dir, 'test.db'));
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('purges expired sessions on its interval', async () => {
    vi.useFakeTimers();
    try {
      const users = new UserRepo(db);
      const sessions = new SessionRepo(db);
      const u = await users.create('a', 'pwlong123');
      const s = sessions.create(u.id);
      db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(Date.now() - 1, s.id);
      const stop = startSessionPurgeTimer(sessions, 60_000);
      vi.advanceTimersByTime(60_000);
      expect(sessions.findValid(s.id)).toBeNull();
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
