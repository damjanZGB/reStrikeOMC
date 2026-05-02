import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import type { Db } from '../db/sqlite.js';

const BCRYPT_ROUNDS = 12;

export interface User {
  id: string;
  username: string;
  createdAt: number;
}

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  created_at: number;
}

export class UserRepo {
  constructor(private readonly db: Db) {}

  count(): number {
    const row = this.db
      .prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM users')
      .get();
    return row?.c ?? 0;
  }

  async create(username: string, password: string): Promise<User> {
    const id = randomUUID();
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const createdAt = Date.now();
    this.db
      .prepare(
        'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)'
      )
      .run(id, username, hash, createdAt);
    return { id, username, createdAt };
  }

  async verify(username: string, password: string): Promise<User | null> {
    const row = this.db
      .prepare<[string], UserRow>(
        'SELECT id, username, password_hash, created_at FROM users WHERE username = ?'
      )
      .get(username);
    if (!row) return null;
    const ok = await bcrypt.compare(password, row.password_hash);
    if (!ok) return null;
    return { id: row.id, username: row.username, createdAt: row.created_at };
  }

  findById(id: string): User | null {
    const row = this.db
      .prepare<[string], UserRow>(
        'SELECT id, username, password_hash, created_at FROM users WHERE id = ?'
      )
      .get(id);
    return row
      ? { id: row.id, username: row.username, createdAt: row.created_at }
      : null;
  }
}
