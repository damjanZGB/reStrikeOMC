import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:net';
import { expandSlash24, probeTcp, scanLan } from './scan.js';

describe('expandSlash24', () => {
  it('returns 254 host addresses for a normal /24', () => {
    const r = expandSlash24('192.168.1.50');
    expect(r).toHaveLength(254);
    expect(r[0]).toBe('192.168.1.1');
    expect(r[r.length - 1]).toBe('192.168.1.254');
  });

  it('returns empty for malformed input', () => {
    expect(expandSlash24('not-an-ip')).toEqual([]);
    expect(expandSlash24('1.2.3')).toEqual([]);
  });
});

describe('probeTcp', () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    server = createServer((sock) => sock.end());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    port = (server.address() as { port: number }).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('returns true for an open port', async () => {
    expect(await probeTcp('127.0.0.1', port, 1000)).toBe(true);
  });

  it('returns false for a closed port (timeout/refused)', async () => {
    // Port 1 is privileged + virtually never open on 127.0.0.1
    expect(await probeTcp('127.0.0.1', 1, 200)).toBe(false);
  });
});

describe('scanLan', () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    server = createServer((sock) => sock.end());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    port = (server.address() as { port: number }).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('finds a listening host in the loopback /24', async () => {
    const result = await scanLan({
      port,
      timeoutMs: 200,
      concurrency: 32,
      cidr: '127.0.0.1',
    });
    expect(result.some((r) => r.host === '127.0.0.1' && r.port === port)).toBe(true);
  }, 20_000);

  it('returns empty when no host responds on the given port', async () => {
    // Port 1 is closed across the loopback /24
    const result = await scanLan({
      port: 1,
      timeoutMs: 100,
      concurrency: 64,
      cidr: '127.0.0.1',
    });
    expect(result).toEqual([]);
  }, 30_000);
});
