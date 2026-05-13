import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server, type Socket } from 'node:net';
import {
  expandSlash24,
  probeTcp,
  scanLan,
  detectProtocol,
  probeWsV5,
  probeWsV4,
} from './scan.js';
import { startMockObs, type MockHandle } from '../obs/mock-server.js';
import { startMockObsV4, type MockV4Handle } from '../obs/mock-server-v4.js';

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
    expect(await probeTcp('127.0.0.1', 1, 200)).toBe(false);
  });
});

describe('probeWsV5 / probeWsV4 / detectProtocol', () => {
  let mockV5: MockHandle;
  let mockV4: MockV4Handle;

  beforeAll(async () => {
    mockV5 = await startMockObs({ password: null });
    mockV4 = await startMockObsV4({ password: null });
  });

  afterAll(async () => {
    await mockV5.close();
    await mockV4.close();
  });

  it('probeWsV5 returns true against a v5 server', async () => {
    expect(await probeWsV5('127.0.0.1', mockV5.port)).toBe(true);
  });

  it('probeWsV5 returns false against a v4 server', async () => {
    expect(await probeWsV5('127.0.0.1', mockV4.port)).toBe(false);
  });

  it('probeWsV4 returns true against a v4 server', async () => {
    expect(await probeWsV4('127.0.0.1', mockV4.port)).toBe(true);
  });

  it('detectProtocol identifies v5', async () => {
    expect(await detectProtocol('127.0.0.1', mockV5.port)).toBe('v5');
  });

  it('detectProtocol identifies v4', async () => {
    expect(await detectProtocol('127.0.0.1', mockV4.port)).toBe('v4');
  });
});

describe('scanLan', () => {
  let mockV5: MockHandle;
  let mockV4: MockV4Handle;
  let plain: Server;
  let plainPort: number;
  const plainSockets = new Set<Socket>();

  beforeAll(async () => {
    mockV5 = await startMockObs({ password: null });
    mockV4 = await startMockObsV4({ password: null });
    plain = createServer((sock) => {
      // Track every accepted socket so the afterAll can force-destroy
      // them. net.Server.close() waits indefinitely for lingering sockets
      // and there is no closeAllConnections on net.Server (that lives on
      // http.Server). Without manual tracking, discovery probes leave
      // sockets in half-open states that block the test from finishing.
      plainSockets.add(sock);
      sock.once('close', () => plainSockets.delete(sock));
      sock.end();
    });
    await new Promise<void>((resolve) => plain.listen(0, '127.0.0.1', () => resolve()));
    plainPort = (plain.address() as { port: number }).port;
  }, 30_000);

  afterAll(async () => {
    await mockV5.close();
    await mockV4.close();
    for (const s of plainSockets) s.destroy();
    plainSockets.clear();
    await new Promise<void>((resolve) => plain.close(() => resolve()));
  }, 30_000);

  it('finds a v5 OBS and tags it with protocol:v5', async () => {
    const result = await scanLan({
      port: mockV5.port,
      timeoutMs: 200,
      concurrency: 16,
      cidr: '127.0.0.1',
    });
    expect(
      result.some((r) => r.host === '127.0.0.1' && r.port === mockV5.port && r.protocol === 'v5')
    ).toBe(true);
  }, 20_000);

  it('finds a v4 OBS and tags it with protocol:v4', async () => {
    const result = await scanLan({
      port: mockV4.port,
      timeoutMs: 200,
      concurrency: 16,
      cidr: '127.0.0.1',
    });
    expect(
      result.some((r) => r.host === '127.0.0.1' && r.port === mockV4.port && r.protocol === 'v4')
    ).toBe(true);
  }, 20_000);

  it('drops a host that opens TCP but does not speak obs-websocket', async () => {
    const result = await scanLan({
      port: plainPort,
      timeoutMs: 200,
      concurrency: 16,
      cidr: '127.0.0.1',
    });
    expect(result).toEqual([]);
  }, 20_000);

  it('returns empty when no host responds on the given port', async () => {
    const result = await scanLan({
      port: 1,
      timeoutMs: 100,
      concurrency: 64,
      cidr: '127.0.0.1',
    });
    expect(result).toEqual([]);
  }, 30_000);
});
