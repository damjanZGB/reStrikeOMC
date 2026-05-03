import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import { scanLan } from '../discovery/scan.js';

const Query = z.object({
  port: z.coerce.number().int().min(1).max(65535).optional(),
  cidr: z.string().optional(),
});

export async function registerDiscoverRoute(
  server: FastifyInstance,
  guard: preHandlerHookHandler
): Promise<void> {
  server.get('/api/discover', { preHandler: guard }, async (req, reply) => {
    const parsed = Query.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_query', issues: parsed.error.issues });
    }
    const hosts = await scanLan({
      port: parsed.data.port,
      cidr: parsed.data.cidr,
      timeoutMs: 800,
      concurrency: 32,
    });
    return { hosts };
  });
}
