import { networkInterfaces } from 'node:os';
import { Socket } from 'node:net';

export interface DiscoverOpts {
  port?: number;
  timeoutMs?: number;
  concurrency?: number;
  cidr?: string;
}

export interface DiscoveredHost {
  host: string;
  port: number;
}

const DEFAULT_PORT = 4455;
const DEFAULT_TIMEOUT_MS = 800;
const DEFAULT_CONCURRENCY = 32;

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

export async function scanLan(opts: DiscoverOpts = {}): Promise<DiscoveredHost[]> {
  const port = opts.port ?? DEFAULT_PORT;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;

  let candidates: string[] = [];
  if (opts.cidr) {
    candidates = expandSlash24(opts.cidr);
  } else {
    const ifaces = getLocalIPv4Interfaces();
    if (ifaces.length === 0) return [];
    // Pick the first non-internal IPv4 and scan its /24
    const primary = ifaces[0]!;
    candidates = expandSlash24(primary.address);
  }

  const found: DiscoveredHost[] = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < candidates.length) {
      const host = candidates[cursor++]!;
      const ok = await probeTcp(host, port, timeoutMs);
      if (ok) found.push({ host, port });
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
    return 0;
  });
  return found;
}
