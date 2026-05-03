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

  const setupProbe = useQuery({
    queryKey: ['setup-status'],
    queryFn: async () => {
      const res = await fetch('/api/setup/status', { credentials: 'include' });
      if (!res.ok) throw new Error(`setup status failed: ${res.status}`);
      return (await res.json()) as { initialized: boolean };
    },
    enabled: meQuery.isError,
    retry: false,
    staleTime: 60_000,
  });

  return {
    user: meQuery.data ?? null,
    loading: meQuery.isLoading || (meQuery.isError && setupProbe.isLoading),
    needsSetup:
      meQuery.isError && setupProbe.isSuccess && !setupProbe.data.initialized,
    error: meQuery.error,
  };
}
