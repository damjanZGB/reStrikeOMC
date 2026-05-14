import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './index.js';

export interface TestServer {
  server: FastifyInstance;
  dir: string;
  close: () => Promise<void>;
}

export async function buildTestServer(
  overrides: { dbPath?: string; cleanupOnClose?: boolean } = {}
): Promise<TestServer> {
  const dir = overrides.dbPath ? '' : mkdtempSync(join(tmpdir(), 'restrike-'));
  const dbPath = overrides.dbPath ?? join(dir, 'test.db');
  const server = await buildServer({
    test: true,
    dbPath,
    sessionSecret: 'a'.repeat(32),
    connectionPasswordKey: 'b'.repeat(32),
  });
  const cleanup = overrides.cleanupOnClose ?? !overrides.dbPath;
  const close = async () => {
    await server.close();
    if (cleanup && dir) rmSync(dir, { recursive: true, force: true });
  };
  return { server, dir, close };
}
