import type { ConnectionConfig, ConnectionInput } from '@restrike/shared';

async function jsonFetch<T = unknown>(
  input: RequestInfo,
  init: RequestInit = {}
): Promise<T> {
  const headers: HeadersInit = {
    'content-type': 'application/json',
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
    return jsonFetch<{ hosts: Array<{ host: string; port: number }> }>(
      `/api/discover${qs}`
    );
  },
};
