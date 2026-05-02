import Fastify, { type FastifyInstance } from 'fastify';

export interface BuildOptions {
  test?: boolean;
}

export async function buildServer(opts: BuildOptions = {}): Promise<FastifyInstance> {
  const server = Fastify({
    logger: opts.test ? false : { level: 'info' },
  });

  server.get('/health', async () => ({ status: 'ok' }));

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 8080);
  const host = process.env.HOST ?? '0.0.0.0';
  const server = await buildServer();
  await server.listen({ port, host });
}
