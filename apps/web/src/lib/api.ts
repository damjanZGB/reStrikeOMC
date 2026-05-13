import type {
  AppSettings,
  ConnectionConfig,
  ConnectionInput,
  ObsProtocol,
} from '@restrike/shared';

async function jsonFetch<T = unknown>(
  input: RequestInfo,
  init: RequestInit = {}
): Promise<T> {
  // Only send Content-Type when there is an actual body. Fastify v5 rejects an
  // empty body whose Content-Type header claims application/json with a 400
  // "Body cannot be empty when content-type is set to 'application/json'".
  const hasBody = init.body !== undefined && init.body !== null;
  const headers: HeadersInit = {
    ...(hasBody ? { 'content-type': 'application/json' } : {}),
    ...(init.headers ?? {}),
  };
  const res = await fetch(input, { credentials: 'include', ...init, headers });
  if (!res.ok) {
    let detail: unknown = null;
    try {
      detail = await res.json();
    } catch {
      // ignore
    }
    const err = new Error(`HTTP ${res.status}: ${res.statusText}`) as Error & {
      status: number;
      detail: unknown;
    };
    err.status = res.status;
    err.detail = detail;
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface MeResponse {
  id: string;
  username: string;
}

export const api = {
  me: () => jsonFetch<MeResponse>('/api/me'),
  setup: (username: string, password: string) =>
    jsonFetch<MeResponse>('/api/setup', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  login: (username: string, password: string) =>
    jsonFetch<MeResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  logout: () =>
    jsonFetch<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
  listConnections: () => jsonFetch<ConnectionConfig[]>('/api/connections'),
  createConnection: (input: ConnectionInput) =>
    jsonFetch<ConnectionConfig>('/api/connections', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateConnection: (id: string, patch: Partial<ConnectionInput>) =>
    jsonFetch<ConnectionConfig>(`/api/connections/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteConnection: (id: string) =>
    jsonFetch<void>(`/api/connections/${id}`, { method: 'DELETE' }),
  testConnection: (id: string) =>
    jsonFetch<{ status: string; message?: string }>(
      `/api/connections/${id}/test`,
      { method: 'POST' }
    ),
  discover: (port?: number) => {
    const qs = port ? `?port=${port}` : '';
    return jsonFetch<{ hosts: Array<{ host: string; port: number; protocol: ObsProtocol }> }>(
      `/api/discover${qs}`
    );
  },
  getSettings: () => jsonFetch<AppSettings>('/api/settings'),
  setSettings: (patch: AppSettings) =>
    jsonFetch<void>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
};
