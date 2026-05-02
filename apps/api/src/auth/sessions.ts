import { randomBytes } from 'node:crypto';
import type { Db } from '../db/sqlite.js';

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export interface SessionRow {
  id: string;
  userId: string;
  expiresAt: number;
}

interface DbRow {
  id: string;
  user_id: string;
  expires_at: number;
}

function newSessionId(): string {
  return randomBytes(32).toString('base64url');
}

export class SessionRepo {
  constructor(private readonly db: Db) {}

  create(userId: string, ttlMs: number = SESSION_TTL_MS): SessionRow {
    const id = newSessionId();
    const now = Date.now();
    const expiresAt = now + ttlMs;
    this.db
      .prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .run(id, userId, expiresAt, now);
    return { id, userId, expiresAt };
  }

  findValid(id: string): SessionRow | null {
    const row = this.db
      .prepare<[string, number], DbRow>(
        'SELECT id, user_id, expires_at FROM sessions WHERE id = ? AND expires_at > ?'
      )
      .get(id, Date.now());
    return row ? { id: row.id, userId: row.user_id, expiresAt: row.expires_at } : null;
  }

  destroy(id: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  }

  destroyAllForUser(userId: string): void {
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }

  purgeExpired(): number {
    const res = this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
    return res.changes;
  }
}
