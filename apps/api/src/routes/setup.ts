import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const SetupBody = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(8).max(256),
});

export async function registerSetupRoute(server: FastifyInstance): Promise<void> {
  server.post('/api/setup', async (req, reply) => {
    const parsed = SetupBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }
    if (server.users.count() > 0) {
      return reply.code(409).send({ error: 'already_initialized' });
    }
    const user = await server.users.create(parsed.data.username, parsed.data.password);
    return reply.code(201).send({ id: user.id, username: user.username });
  });
}
