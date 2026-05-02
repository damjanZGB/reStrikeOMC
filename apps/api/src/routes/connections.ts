import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
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
}

export const ConnectionPatchSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  host: z.string().min(1).max(255).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  password: z.string().max(256).optional(),
});

export const ConnectionParams = z.object({ id: z.string().uuid() });
