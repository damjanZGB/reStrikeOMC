import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { SESSION_COOKIE_NAME } from '../routes/auth.js';
import type { User } from './users.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: User;
    sessionId?: string;
  }
}

export function makeRequireSession(server: FastifyInstance) {
  return async function requireSession(
    req: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const raw = req.cookies[SESSION_COOKIE_NAME];
    if (!raw) {
      reply.code(401).send({ error: 'unauthenticated' });
      return;
    }

    const unsigned = req.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) {
      reply.code(401).send({ error: 'unauthenticated' });
      return;
    }

    const sess = server.sessions.findValid(unsigned.value);
    if (!sess) {
      reply.code(401).send({ error: 'unauthenticated' });
      return;
    }

    const user = server.users.findById(sess.userId);
    if (!user) {
      reply.code(401).send({ error: 'unauthenticated' });
      return;
    }

    req.user = user;
    req.sessionId = sess.id;
  };
}
