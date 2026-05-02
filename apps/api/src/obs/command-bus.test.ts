import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations, type Db } from '../db/sqlite.js';
import { UserRepo } from '../auth/users.js';
import { startMockObs, type MockHandle } from './mock-server.js';
import { ConnectionManager } from './connection-manager.js';
import { CommandBus } from './command-bus.js';
import { AuditRepo } from '../audit/audit-repo.js';

let db: Db;
let dir: string;
let mock: MockHandle;
let mgr: ConnectionManager;
let bus: CommandBus;
let users: UserRepo;
let audit: AuditRepo;
let userId: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'restrike-'));
  db = openDb(join(dir, 'test.db'));
  runMigrations(db);
  users = new UserRepo(db);
  userId = (await users.create('a', 'pwlong123')).id;
  audit = new AuditRepo(db);
  mock = await startMockObs({ password: null });
  mgr = new ConnectionManager();
  bus = new CommandBus(mgr, audit);
});

afterEach(async () => {
  await mgr.closeAll();
  await mock.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('CommandBus', () => {
  it('fans out to all targets and reports per-target failures', async () => {
    const okId = '00000000-0000-0000-0000-000000000060';
    const badId = '00000000-0000-0000-0000-000000000061';
    await mgr.add({ id: okId, host: '127.0.0.1', port: mock.port, password: null });
    await mgr.waitForStatus(okId, 'connected', 2000);
    await mgr.add({ id: badId, host: '127.0.0.1', port: 1, password: null });

    const result = await bus.dispatch({
      userId,
      action: 'SetCurrentProgramScene',
      targets: [okId, badId],
      payload: { sceneName: 'Scene 2' },
    });

    expect(result.ok).toEqual([okId]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.connId).toBe(badId);

    const rows = audit.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('SetCurrentProgramScene');
  });

  it('rejects unknown action', async () => {
    await expect(
      bus.dispatch({
        userId,
        action: 'Bogus',
        targets: ['00000000-0000-0000-0000-000000000062'],
        payload: {},
      })
    ).rejects.toThrow(/unknown_action/);
  });

  it('rejects invalid payload for known action', async () => {
    await expect(
      bus.dispatch({
        userId,
        action: 'SetCurrentProgramScene',
        targets: ['00000000-0000-0000-0000-000000000063'],
        payload: { wrong: 'field' },
      })
    ).rejects.toThrow(/invalid_payload/);
  });
});
