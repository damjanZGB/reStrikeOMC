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

export async function buildTestServer(): Promise<TestServer> {
  const dir = mkdtempSync(join(tmpdir(), 'restrike-'));
  const server = await buildServer({
    test: true,
    dbPath: join(dir, 'test.db'),
    sessionSecret: 'a'.repeat(32),
    connectionPasswordKey: 'b'.repeat(32),
  });
  const close = async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  };
  return { server, dir, close };
}
