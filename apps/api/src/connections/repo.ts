import { randomUUID } from 'node:crypto';
import type { Db } from '../db/sqlite.js';
import { encrypt, decrypt } from '../auth/crypto.js';
import type { ConnectionConfig, ConnectionInput } from '@restrike/shared';

interface DbRow {
  id: string;
  name: string;
  host: string;
  port: number;
  password_ciphertext: Buffer | null;
  password_iv: Buffer | null;
  created_at: number;
}

function rowToConfig(row: DbRow): ConnectionConfig {
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    hasPassword: row.password_ciphertext !== null,
  };
}

export class ConnectionRepo {
  constructor(private readonly db: Db, private readonly key: Buffer) {}

  create(input: ConnectionInput): ConnectionConfig {
    const id = randomUUID();
    let ciphertext: Buffer | null = null;
    let iv: Buffer | null = null;
    if (input.password && input.password.length > 0) {
      const enc = encrypt(this.key, input.password);
      ciphertext = enc.ciphertext;
      iv = enc.iv;
    }
    this.db
      .prepare(
        `INSERT INTO connections
         (id, name, host, port, password_ciphertext, password_iv, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, input.name, input.host, input.port, ciphertext, iv, Date.now());
    return this.findById(id)!;
  }

  list(): ConnectionConfig[] {
    return this.db
      .prepare<[], DbRow>(
        'SELECT id, name, host, port, password_ciphertext, password_iv, created_at FROM connections ORDER BY created_at ASC'
      )
      .all()
      .map(rowToConfig);
  }

  findById(id: string): ConnectionConfig | null {
    const row = this.db
      .prepare<[string], DbRow>(
        'SELECT id, name, host, port, password_ciphertext, password_iv, created_at FROM connections WHERE id = ?'
      )
      .get(id);
    return row ? rowToConfig(row) : null;
  }

  update(
    id: string,
    patch: Partial<ConnectionInput>
  ): ConnectionConfig | null {
    const existing = this.findById(id);
    if (!existing) return null;
    const fields: string[] = [];
    const values: unknown[] = [];
    if (patch.name !== undefined) { fields.push('name = ?'); values.push(patch.name); }
    if (patch.host !== undefined) { fields.push('host = ?'); values.push(patch.host); }
    if (patch.port !== undefined) { fields.push('port = ?'); values.push(patch.port); }
    if (patch.password !== undefined) {
      if (patch.password.length === 0) {
        fields.push('password_ciphertext = NULL', 'password_iv = NULL');
      } else {
        const enc = encrypt(this.key, patch.password);
        fields.push('password_ciphertext = ?', 'password_iv = ?');
        values.push(enc.ciphertext, enc.iv);
      }
    }
    if (fields.length === 0) return existing;
    values.push(id);
    this.db
      .prepare(`UPDATE connections SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values);
    return this.findById(id);
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM connections WHERE id = ?').run(id).changes > 0;
  }

  getPassword(id: string): string | null {
    const row = this.db
      .prepare<[string], { password_ciphertext: Buffer | null; password_iv: Buffer | null }>(
        'SELECT password_ciphertext, password_iv FROM connections WHERE id = ?'
      )
      .get(id);
    if (!row || !row.password_ciphertext || !row.password_iv) return null;
    return decrypt(this.key, row.password_ciphertext, row.password_iv);
  }
}
