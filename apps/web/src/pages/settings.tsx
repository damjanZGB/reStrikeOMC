import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ObsProtocol } from '@restrike/shared';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';

export function SettingsPage(): JSX.Element {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.getSettings });
  const [draft, setDraft] = useState<ObsProtocol>('v5');

  useEffect(() => {
    if (settings.data) setDraft(settings.data.defaultProtocol);
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () => api.setSettings({ defaultProtocol: draft }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });

  const dirty = settings.data ? draft !== settings.data.defaultProtocol : false;

  return (
    <div className="grid gap-6 max-w-xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Settings</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>OBS-WebSocket protocol</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <p className="text-sm text-muted-foreground">
            Sets the default protocol used by new connections and by any
            existing connection whose protocol field is left as
            &quot;default&quot;. Already-connected tiles keep the protocol
            they were originally resolved with — to apply a new default
            to an existing tile, edit and save it (any host/port/protocol
            change triggers a reconnect under the resolved default).
          </p>
          <div className="grid gap-2">
            <Label htmlFor="settings-default-protocol">Default protocol</Label>
            <select
              id="settings-default-protocol"
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={draft}
              onChange={(e) => setDraft(e.target.value as ObsProtocol)}
              disabled={settings.isLoading}
            >
              <option value="v5">v5 (modern — OBS Studio 28+ built-in)</option>
              <option value="v4">v4 (legacy — obs-websocket plugin 4.x)</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
              {save.isPending ? 'Saving...' : 'Save'}
            </Button>
            {save.isError ? (
              <span className="text-sm text-state-bad">
                {(save.error as Error).message}
              </span>
            ) : save.isSuccess && !dirty ? (
              <span className="text-sm text-state-ok">Saved.</span>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
