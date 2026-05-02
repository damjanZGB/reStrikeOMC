import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const LoginBody = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});

export const SESSION_COOKIE_NAME = 'restrike_sess';

export async function registerAuthRoutes(server: FastifyInstance): Promise<void> {
  server.post('/api/auth/login', async (req, reply) => {
    const parsed = LoginBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

    const user = await server.users.verify(parsed.data.username, parsed.data.password);
    if (!user) return reply.code(401).send({ error: 'invalid_credentials' });

    const sess = server.sessions.create(user.id);
    reply.setCookie(SESSION_COOKIE_NAME, sess.id, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      signed: true,
      maxAge: Math.floor((sess.expiresAt - Date.now()) / 1000),
    });
    return { id: user.id, username: user.username };
  });

  server.post('/api/auth/logout', async (req, reply) => {
    const cookie = req.cookies[SESSION_COOKIE_NAME];
    if (cookie) {
      const unsigned = req.unsignCookie(cookie);
      if (unsigned.valid && unsigned.value) {
        server.sessions.destroy(unsigned.value);
      }
    }
    reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    return { ok: true };
  });
}
