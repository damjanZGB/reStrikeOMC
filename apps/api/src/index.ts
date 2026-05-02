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
import { makeRequireSession } from './auth/middleware.js';
import { startSessionPurgeTimer } from './auth/purge.js';
import { ConnectionRepo } from './connections/repo.js';
import { registerConnectionRoutes } from './routes/connections.js';
import { ConnectionManager } from './obs/connection-manager.js';
import { WsHub } from './realtime/ws-hub.js';
import { StateStore } from './state/state-store.js';
import { EventCoalescer } from './state/event-coalescer.js';
import { wireOBSToState } from './state/wire.js';
import { CommandBus } from './obs/command-bus.js';
import { AuditRepo } from './audit/audit-repo.js';

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
    obsManager: ConnectionManager;
    hub: WsHub;
    audit: AuditRepo;
    commandBus: CommandBus;
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
  const connections = new ConnectionRepo(db, passwordKey);
  const obsManager = new ConnectionManager();

  server.decorate('db', db);
  server.decorate('users', users);
  server.decorate('sessions', sessions);
  server.decorate('passwordKey', passwordKey);
  server.decorate('connections', connections);
  server.decorate('obsManager', obsManager);

  const stopPurge = startSessionPurgeTimer(sessions);
  server.addHook('onClose', async () => {
    stopPurge();
    await obsManager.closeAll();
    db.close();
  });

  server.get('/health', async () => ({ status: 'ok' }));

  await registerSetupRoute(server);
  await registerAuthRoutes(server);

  const requireSession = makeRequireSession(server);
  server.get('/api/me', { preHandler: requireSession }, async (req) => ({
    id: req.user!.id,
    username: req.user!.username,
  }));

  await registerConnectionRoutes(server, requireSession);

  const audit = new AuditRepo(db);
  const commandBus = new CommandBus(obsManager, audit);
  server.decorate('audit', audit);
  server.decorate('commandBus', commandBus);

  const stateStore = new StateStore();
  const hub = new WsHub(server, stateStore, commandBus);
  server.decorate('hub', hub);
  const coalescer = new EventCoalescer((diff) => {
    if (stateStore.applyDiff(diff)) hub.broadcastDiff(diff);
  });
  wireOBSToState(obsManager, stateStore, coalescer);
  server.addHook('onClose', async () => {
    coalescer.destroy();
    hub.close();
  });

  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 8080);
  const host = process.env.HOST ?? '0.0.0.0';
  const server = await buildServer();
  await server.listen({ port, host });
}
