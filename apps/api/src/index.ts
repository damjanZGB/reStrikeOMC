import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import type { Db } from './db/sqlite.js';
import { openDb, runMigrations } from './db/sqlite.js';
import { UserRepo } from './auth/users.js';
import { SessionRepo } from './auth/sessions.js';
import { deriveKeyFromString } from './auth/crypto.js';
import { registerSetupRoute } from './routes/setup.js';
import { registerAuthRoutes } from './routes/auth.js';

export interface BuildOptions {
  test?: boolean;
  dbPath?: string;
  sessionSecret?: string;
  connectionPasswordKey?: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
    users: UserRepo;
    sessions: SessionRepo;
    passwordKey: Buffer;
  }
}

export async function buildServer(opts: BuildOptions = {}): Promise<FastifyInstance> {
  const dbPath = opts.dbPath ?? process.env.DB_PATH ?? './data/restrike.db';
  const sessionSecret = opts.sessionSecret ?? process.env.SESSION_COOKIE_SECRET;
  const connectionPasswordKey =
    opts.connectionPasswordKey ?? process.env.CONNECTION_PASSWORD_KEY;
  if (!sessionSecret || sessionSecret.length < 32) {
    throw new Error('SESSION_COOKIE_SECRET must be set and >= 32 chars');
  }
  if (!connectionPasswordKey || connectionPasswordKey.length < 16) {
    throw new Error('CONNECTION_PASSWORD_KEY must be set and >= 16 chars');
  }

  const server = Fastify({ logger: opts.test ? false : { level: 'info' } });

  await server.register(fastifyCookie, { secret: sessionSecret });

  const db = openDb(dbPath);
  runMigrations(db);

  const users = new UserRepo(db);
  const sessions = new SessionRepo(db);
  const passwordKey = deriveKeyFromString(connectionPasswordKey);

  server.decorate('db', db);
  server.decorate('users', users);
  server.decorate('sessions', sessions);
  server.decorate('passwordKey', passwordKey);

  server.addHook('onClose', async () => {
    db.close();
  });

  server.get('/health', async () => ({ status: 'ok' }));

  await registerSetupRoute(server);
  await registerAuthRoutes(server);

  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 8080);
  const host = process.env.HOST ?? '0.0.0.0';
  const server = await buildServer();
  await server.listen({ port, host });
}
