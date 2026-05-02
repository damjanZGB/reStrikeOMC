import { useQuery } from '@tanstack/react-query';
import { api, type MeResponse } from '@/lib/api';

export interface UseMeResult {
  user: MeResponse | null;
  loading: boolean;
  needsSetup: boolean;
  error: unknown;
}

export function useMe(): UseMeResult {
  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: () => api.me(),
    retry: false,
    staleTime: 60_000,
  });

  // If /api/me returns 401, try to detect setup state by attempting a login probe.
  // First-run check: a 401 plus "no users" is detected by attempting setup with bogus
  // creds and observing 409 (already initialized) vs success-eligible.
  const setupProbe = useQuery({
    queryKey: ['setup-probe'],
    queryFn: async () => {
      // Try setup with intentionally invalid (too short) password to see if endpoint
      // accepts the route (no users) vs rejects (users exist). Setup endpoint returns
      // 409 if already initialized, 400 for invalid body, 201 for success.
      const res = await fetch('/api/setup', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: '', password: '' }),
      });
      // 409 = users already exist. 400 = no users yet (validation failed but endpoint open).
      return res.status === 409 ? 'has_users' : 'no_users';
    },
    enabled: meQuery.isError,
    retry: false,
    staleTime: 60_000,
  });

  return {
    user: meQuery.data ?? null,
    loading: meQuery.isLoading || (meQuery.isError && setupProbe.isLoading),
    needsSetup:
      meQuery.isError && setupProbe.isSuccess && setupProbe.data === 'no_users',
    error: meQuery.error,
  };
}
