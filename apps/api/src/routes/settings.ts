import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { AppSettingsSchema } from '@restrike/shared';
import type { SettingsRepo } from '../settings/repo.js';

declare module 'fastify' {
  interface FastifyInstance {
    settings: SettingsRepo;
  }
}

export async function registerSettingsRoutes(
  server: FastifyInstance,
  guard: preHandlerHookHandler
): Promise<void> {
  server.get('/api/settings', { preHandler: guard }, async () => server.settings.getAll());

  server.put('/api/settings', { preHandler: guard }, async (req, reply) => {
    const parsed = AppSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }
    // Note: this updates the persisted default only. Already-connected
    // slots are NOT re-resolved — they keep the protocol resolved at
    // manager.add() time. Operators who want the new default applied
    // immediately must reconnect each affected connection (or restart).
    // Pinned by routes/settings.test.ts: "PUT /api/settings does not
    // re-resolve live NULL-protocol slots".
    server.settings.setDefaultProtocol(parsed.data.defaultProtocol);
    return reply.code(204).send();
  });
}
