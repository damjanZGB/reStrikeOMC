import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import { ConnectionInputSchema, ObsProtocolSchema } from '@restrike/shared';
import { ConnectionRepo } from '../connections/repo.js';
import { createObsClient, AuthFailedError } from '../obs/clients/index.js';

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
    // Open the live socket immediately so the dashboard reflects state without
    // waiting for a server restart.
    void server.obsManager.add({
      id: c.id,
      host: c.host,
      port: c.port,
      password: parsed.data.password ?? null,
      protocol: server.settings.resolveProtocol(c.protocol),
    });
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
    // If anything that affects the live socket changed (host, port, password),
    // tear down the existing slot and re-add with the new config. Pure renames
    // skip the cycle so the user doesn't lose connection state for a label edit.
    const reconnectFields: Array<keyof typeof body.data> = ['host', 'port', 'password', 'protocol'];
    const needsReconnect = reconnectFields.some(
      (k) => body.data[k] !== undefined
    );
    if (needsReconnect) {
      await server.obsManager.remove(updated.id);
      const password = server.connections.getPassword(updated.id);
      void server.obsManager.add({
        id: updated.id,
        host: updated.host,
        port: updated.port,
        password,
        protocol: server.settings.resolveProtocol(updated.protocol),
      });
    }
    return updated;
  });

  server.delete('/api/connections/:id', { preHandler: guard }, async (req, reply) => {
    const params = ConnectionParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_id' });
    if (!server.connections.delete(params.data.id)) {
      return reply.code(404).send({ error: 'not_found' });
    }
    // Stop the manager from continuing to dial a now-deleted connection.
    await server.obsManager.remove(params.data.id);
    return reply.code(204).send();
  });

  server.post('/api/connections/:id/test', { preHandler: guard }, async (req, reply) => {
    const params = ConnectionParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_id' });
    const conn = server.connections.findById(params.data.id);
    if (!conn) return reply.code(404).send({ error: 'not_found' });
    const password = server.connections.getPassword(params.data.id);
    const protocol = server.settings.resolveProtocol(conn.protocol);
    const client = createObsClient(protocol);
    try {
      await client.connect(`ws://${conn.host}:${conn.port}`, password ?? undefined, {});
      await client.disconnect();
      return { status: 'ok' };
    } catch (err) {
      if (err instanceof AuthFailedError) return { status: 'auth_failed' };
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
  protocol: ObsProtocolSchema.nullable().optional(),
});

export const ConnectionParams = z.object({ id: z.string().uuid() });
