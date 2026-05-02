import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import { OBSWebSocket } from 'obs-websocket-js';
import { ConnectionInputSchema } from '@restrike/shared';
import { ConnectionRepo } from '../connections/repo.js';

declare module 'fastify' {
  interface FastifyInstance {
    connections: ConnectionRepo;
  }
}

export async function registerConnectionRoutes(
  server: FastifyInstance,
  guard: preHandlerHookHandler
): Promise<void> {
  server.get('/api/connections', { preHandler: guard }, async () =>
    server.connections.list()
  );

  server.post('/api/connections', { preHandler: guard }, async (req, reply) => {
    const parsed = ConnectionInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }
    const c = server.connections.create(parsed.data);
    return reply.code(201).send(c);
  });

  server.patch('/api/connections/:id', { preHandler: guard }, async (req, reply) => {
    const params = ConnectionParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_id' });
    const body = ConnectionPatchSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: body.error.issues });
    }
    const updated = server.connections.update(params.data.id, body.data);
    if (!updated) return reply.code(404).send({ error: 'not_found' });
    return updated;
  });

  server.delete('/api/connections/:id', { preHandler: guard }, async (req, reply) => {
    const params = ConnectionParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_id' });
    if (!server.connections.delete(params.data.id)) {
      return reply.code(404).send({ error: 'not_found' });
    }
    return reply.code(204).send();
  });

  server.post('/api/connections/:id/test', { preHandler: guard }, async (req, reply) => {
    const params = ConnectionParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_id' });
    const conn = server.connections.findById(params.data.id);
    if (!conn) return reply.code(404).send({ error: 'not_found' });
    const password = server.connections.getPassword(params.data.id);
    const obs = new OBSWebSocket();
    try {
      await obs.connect(`ws://${conn.host}:${conn.port}`, password ?? undefined);
      await obs.disconnect();
      return { status: 'ok' };
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code === 4009) return { status: 'auth_failed' };
      return { status: 'unreachable', message: String(err) };
    }
  });
}

export const ConnectionPatchSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  host: z.string().min(1).max(255).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  password: z.string().max(256).optional(),
});

export const ConnectionParams = z.object({ id: z.string().uuid() });
