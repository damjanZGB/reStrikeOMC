import type { Db } from '../db/sqlite.js';
import type { PerTargetFailure } from '@restrike/shared';

export interface AuditEntry {
  id: number;
  ts: number;
  userId: string;
  action: string;
  targets: string[];
  result: { ok: string[]; failed: PerTargetFailure[] };
}

export class AuditRepo {
  constructor(private readonly db: Db) {}

  write(
    userId: string,
    action: string,
    targets: string[],
    result: AuditEntry['result']
  ): void {
    this.db
      .prepare(
        'INSERT INTO audit_log (ts, user_id, action, targets, result) VALUES (?, ?, ?, ?, ?)'
      )
      .run(Date.now(), userId, action, JSON.stringify(targets), JSON.stringify(result));
  }

  list(limit = 100): AuditEntry[] {
    const rows = this.db
      .prepare<
        [number],
        {
          id: number;
          ts: number;
          user_id: string;
          action: string;
          targets: string;
          result: string;
        }
      >(
        'SELECT id, ts, user_id, action, targets, result FROM audit_log ORDER BY ts DESC LIMIT ?'
      )
      .all(limit);
    return rows.map((r) => ({
      id: r.id,
      ts: r.ts,
      userId: r.user_id,
      action: r.action,
      targets: JSON.parse(r.targets),
      result: JSON.parse(r.result),
    }));
  }
}
