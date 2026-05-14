import { networkInterfaces } from 'node:os';
import { Socket } from 'node:net';
import { WebSocket } from 'ws';
import type { ObsProtocol } from '@restrike/shared';

export interface DiscoverOpts {
  /**
   * When set, probe only this port. When omitted, probe both the v4 default
   * (4444) and the v5 default (4455) on every candidate host.
   */
  port?: number;
  /**
   * Explicit list of ports to probe. Overrides both `port` and the default
   * dual-port list. Mostly useful for tests that need to point at mock
   * servers on dynamic ports.
   */
  ports?: number[];
  timeoutMs?: number;
  concurrency?: number;
  cidr?: string;
}

export interface DiscoveredHost {
  host: string;
  port: number;
  protocol: ObsProtocol;
}

const DEFAULT_TIMEOUT_MS = 800;
const DEFAULT_CONCURRENCY = 32;
const HANDSHAKE_TIMEOUT_MS = 350;
const V4_DEFAULT_PORT = 4444;
const V5_DEFAULT_PORT = 4455;

export function getLocalIPv4Interfaces(): Array<{ address: string; netmask: string }> {
  const ifaces = networkInterfaces();
  const out: Array<{ address: string; netmask: string }> = [];
  for (const list of Object.values(ifaces)) {
    if (!list) continue;
    for (const i of list) {
      if (i.family === 'IPv4' && !i.internal) {
        out.push({ address: i.address, netmask: i.netmask });
      }
    }
  }
  return out;
}

/** Expand a /24 into 254 host addresses (skipping .0 and .255). */
export function expandSlash24(address: string): string[] {
  const parts = address.split('.');
  if (parts.length !== 4) return [];
  const [a, b, c] = parts;
  const out: string[] = [];
  for (let i = 1; i <= 254; i++) out.push(`${a}.${b}.${c}.${i}`);
  return out;
}

export function probeTcp(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    let done = false;
    const finish = (ok: boolean): void => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

/**
 * Open a WebSocket with the obs-websocket json subprotocol and wait for a
 * Hello frame ({op: 0, ...}). Returns true only if a valid v5 Hello arrives
 * within HANDSHAKE_TIMEOUT_MS.
 */
export function probeWsV5(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        // terminate() force-kills the socket immediately. close() can hang
        // when the server rejected the upgrade and there's no in-band close
        // frame to negotiate — important during LAN scans because each
        // host's open file descriptors otherwise pile up and block the
        // scanning process's afterAll teardown.
        ws.terminate();
      } catch {
        // ignore
      }
      resolve(result);
    };
    const ws = new WebSocket(`ws://${host}:${port}`, 'obswebsocket.json');
    const timer = setTimeout(() => finish(false), HANDSHAKE_TIMEOUT_MS);
    ws.once('error', () => finish(false));
    ws.once('unexpected-response', () => finish(false));
    ws.once('message', (raw) => {
      try {
        const frame = JSON.parse(raw.toString('utf-8')) as { op?: unknown };
        finish(frame.op === 0);
      } catch {
        finish(false);
      }
    });
  });
}

/**
 * Open a plain WebSocket (no subprotocol), send GetAuthRequired, and look for
 * a response frame carrying a matching message-id and a `status` field. This
 * is unmistakably v4.
 */
export function probeWsV4(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.terminate();
      } catch {
        // ignore
      }
      resolve(result);
    };
    const ws = new WebSocket(`ws://${host}:${port}`);
    const timer = setTimeout(() => finish(false), HANDSHAKE_TIMEOUT_MS);
    ws.once('error', () => finish(false));
    ws.once('unexpected-response', () => finish(false));
    ws.once('open', () => {
      try {
        ws.send(JSON.stringify({ 'request-type': 'GetAuthRequired', 'message-id': 'd' }));
      } catch {
        finish(false);
      }
    });
    ws.once('message', (raw) => {
      try {
        const frame = JSON.parse(raw.toString('utf-8')) as { 'message-id'?: unknown; status?: unknown };
        finish(frame['message-id'] === 'd' && typeof frame.status === 'string');
      } catch {
        finish(false);
      }
    });
  });
}

/**
 * Determine which protocol (if any) a TCP-open host speaks. Tries v5 first
 * (most common), falls back to v4. Returns null when the host does not look
 * like obs-websocket.
 */
export async function detectProtocol(host: string, port: number): Promise<ObsProtocol | null> {
  if (await probeWsV5(host, port)) return 'v5';
  if (await probeWsV4(host, port)) return 'v4';
  return null;
}

export async function scanLan(opts: DiscoverOpts = {}): Promise<DiscoveredHost[]> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
  const ports =
    opts.ports ??
    (opts.port !== undefined ? [opts.port] : [V4_DEFAULT_PORT, V5_DEFAULT_PORT]);

  let hosts: string[] = [];
  if (opts.cidr) {
    hosts = expandSlash24(opts.cidr);
  } else {
    const ifaces = getLocalIPv4Interfaces();
    if (ifaces.length === 0) return [];
    hosts = expandSlash24(ifaces[0]!.address);
  }

  // Expand the (host, port) cross-product so each worker can pull a single
  // candidate independently. With both ports probed by default, the
  // candidate count doubles — still bounded by the concurrency knob.
  const candidates: Array<{ host: string; port: number }> = [];
  for (const host of hosts) {
    for (const port of ports) candidates.push({ host, port });
  }

  const found: DiscoveredHost[] = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < candidates.length) {
      const c = candidates[cursor++]!;
      if (!(await probeTcp(c.host, c.port, timeoutMs))) continue;
      const protocol = await detectProtocol(c.host, c.port);
      if (protocol) found.push({ host: c.host, port: c.port, protocol });
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, candidates.length) }, () =>
    worker()
  );
  await Promise.all(workers);

  found.sort((a, b) => {
    const oa = a.host.split('.').map(Number);
    const ob = b.host.split('.').map(Number);
    for (let i = 0; i < 4; i++) {
      if ((oa[i] ?? 0) !== (ob[i] ?? 0)) return (oa[i] ?? 0) - (ob[i] ?? 0);
    }
    return a.port - b.port;
  });
  return found;
}
