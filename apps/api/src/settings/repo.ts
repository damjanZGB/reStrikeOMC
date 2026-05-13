import type { Db } from '../db/sqlite.js';
import type { AppSettings, ObsProtocol } from '@restrike/shared';

/**
 * Key/value store for tunables that need to survive restarts and be mutable
 * at runtime (unlike env vars). Currently only carries `defaultProtocol`;
 * extend the schema in @restrike/shared when adding new keys.
 */
export class SettingsRepo {
  constructor(private readonly db: Db) {}

  private get(key: string): string | null {
    const row = this.db
      .prepare<[string], { value: string }>('SELECT value FROM app_settings WHERE key = ?')
      .get(key);
    return row?.value ?? null;
  }

  private set(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO app_settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(key, value);
  }

  getAll(): AppSettings {
    const proto = this.get('defaultProtocol');
    return {
      defaultProtocol: proto === 'v4' || proto === 'v5' ? (proto as ObsProtocol) : 'v5',
    };
  }

  setDefaultProtocol(proto: ObsProtocol): void {
    this.set('defaultProtocol', proto);
  }

  /** Resolves a per-connection protocol override against the global default. */
  resolveProtocol(rowProtocol: ObsProtocol | null): ObsProtocol {
    return rowProtocol ?? this.getAll().defaultProtocol;
  }
}
