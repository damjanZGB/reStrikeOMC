import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SettingsPage } from './settings';

function setup(): void {
  const qc = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        // Disable refetch triggers in tests — the mock returns a single
        // response, and any refetch would return undefined → settings.data
        // would unset → the dirty-check returns false → Save mysteriously
        // disables. Pinning staleTime to Infinity also avoids GC churn.
        staleTime: Infinity,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
    },
  });
  render(
    <QueryClientProvider client={qc}>
      <SettingsPage />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockGetSettings(defaultProtocol: 'v4' | 'v5'): void {
  // Mock all GET /api/settings calls (not just the first one) so any
  // unexpected re-render-triggered refetch still receives valid data.
  vi.mocked(fetch).mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    if (url === '/api/settings') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ defaultProtocol }),
        headers: new Headers(),
      } as unknown as Response;
    }
    throw new Error('unexpected fetch ' + url);
  });
}

describe('SettingsPage', () => {
  it('renders the seeded default protocol after loading', async () => {
    mockGetSettings('v5');
    setup();
    await waitFor(() => {
      const select = screen.getByLabelText(/default protocol/i) as HTMLSelectElement;
      expect(select.value).toBe('v5');
    });
  });

  it('disables Save until the dropdown value changes', async () => {
    mockGetSettings('v5');
    const user = userEvent.setup();
    setup();
    // The select is initially `disabled` while settings.isLoading is true.
    // userEvent silently no-ops on disabled elements, so wait for the
    // disabled flag to clear before driving the change.
    await waitFor(() => {
      const select = document.getElementById(
        'settings-default-protocol'
      ) as HTMLSelectElement;
      expect(select.disabled).toBe(false);
      expect(select.value).toBe('v5');
    });
    const save = screen.getByRole('button', { name: /save/i });
    expect(save).toBeDisabled();
    const select = document.getElementById(
      'settings-default-protocol'
    ) as HTMLSelectElement;
    await user.selectOptions(select, 'v4');
    expect(select.value).toBe('v4');
    expect(save).not.toBeDisabled();
  });

  it('PUTs to /api/settings on save with the new value', async () => {
    // Mock both endpoints: GET /api/settings returns v5, PUT /api/settings
    // returns 204. The invalidate after save triggers a refetch — we route
    // that to a v4 response, but since this test only asserts the PUT body,
    // the post-save GET shape doesn't actually matter.
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      const method = (init as RequestInit | undefined)?.method ?? 'GET';
      if (url === '/api/settings' && method === 'PUT') {
        return {
          ok: true,
          status: 204,
          json: async () => ({}),
          headers: new Headers(),
        } as unknown as Response;
      }
      if (url === '/api/settings') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ defaultProtocol: 'v5' }),
          headers: new Headers(),
        } as unknown as Response;
      }
      throw new Error('unexpected fetch ' + url);
    });
    const user = userEvent.setup();
    setup();
    await waitFor(() => {
      const select = document.getElementById(
        'settings-default-protocol'
      ) as HTMLSelectElement;
      expect(select.disabled).toBe(false);
      expect(select.value).toBe('v5');
    });
    const select = document.getElementById(
      'settings-default-protocol'
    ) as HTMLSelectElement;
    await user.selectOptions(select, 'v4');
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      const calls = vi.mocked(fetch).mock.calls;
      const put = calls.find(
        (c) => (c[1] as RequestInit | undefined)?.method === 'PUT'
      );
      expect(put).toBeDefined();
      expect(put?.[0]).toBe('/api/settings');
      expect(JSON.parse((put?.[1] as RequestInit | undefined)?.body as string)).toEqual(
        { defaultProtocol: 'v4' }
      );
    });
  });
});
