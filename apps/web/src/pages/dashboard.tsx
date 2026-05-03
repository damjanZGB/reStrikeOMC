import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ConnectionConfig, InstanceState, PerTargetFailure } from '@restrike/shared';
import { api } from '@/lib/api';
import { useWs, useWsStore } from '@/realtime/use-ws';
import { useSelectionStore } from '@/state/selection';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { AudioMixer } from '@/components/audio-mixer';
import { Wifi, WifiOff, Radio, RadioReceiver } from 'lucide-react';
import { cn } from '@/lib/utils';

export function DashboardPage(): JSX.Element {
  const ws = useWs();
  const states = useWsStore((s) => s.states);
  const conns = useQuery({ queryKey: ['connections'], queryFn: api.listConnections });
  const selected = useSelectionStore((s) => s.selected);
  const toggle = useSelectionStore((s) => s.toggle);
  const setSel = useSelectionStore((s) => s.set);
  const [lastResult, setLastResult] = useState<{
    action: string;
    ok: string[];
    failed: PerTargetFailure[];
  } | null>(null);

  // Tile = backend known connection (not ws state, since ws state lags until OBS connects)
  const tiles = useMemo(() => {
    if (!conns.data) return [];
    return conns.data.map((c) => ({ conn: c, live: states[c.id] }));
  }, [conns.data, states]);

  const allIds = tiles.map((t) => t.conn.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));

  // Aggregate scenes across selected tiles' live states for the global command bar
  const sceneOptions = useMemo(() => {
    const scenes = new Set<string>();
    for (const id of selected) {
      const s = states[id];
      if (!s) continue;
      for (const sc of s.scenes) scenes.add(sc.name);
    }
    return Array.from(scenes).sort();
  }, [selected, states]);

  async function fanOut(action: string, payload: Record<string, unknown>): Promise<void> {
    const targets = Array.from(selected);
    if (targets.length === 0) return;
    const r = await ws.dispatch(action, targets, payload);
    setLastResult({ action, ok: r.ok, failed: r.failed });
  }

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <div className="flex items-center gap-2 text-sm">
          {ws.connected ? (
            <span className="flex items-center gap-1 text-green-600">
              <Wifi className="h-4 w-4" /> Live
            </span>
          ) : (
            <span className="flex items-center gap-1 text-muted-foreground">
              <WifiOff className="h-4 w-4" /> Disconnected
            </span>
          )}
        </div>
      </div>

      {/* Global command bar */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span>
              Selection ({selected.size} of {tiles.length})
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => (allSelected ? setSel([]) : setSel(allIds))}
              >
                {allSelected ? 'Clear all' : 'Select all'}
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {selected.size === 0 ? (
            <p className="text-sm text-muted-foreground">
              Select one or more tiles to enable fan-out commands.
            </p>
          ) : (
            <div className="grid gap-3">
              <div>
                <p className="text-xs uppercase text-muted-foreground mb-2">Switch scene</p>
                <div className="flex flex-wrap gap-2">
                  {sceneOptions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No scenes available — selected instances have no live snapshot yet.
                    </p>
                  ) : (
                    sceneOptions.map((name) => (
                      <Button
                        key={name}
                        size="sm"
                        onClick={() =>
                          fanOut('SetCurrentProgramScene', { sceneName: name })
                        }
                      >
                        {name}
                      </Button>
                    ))
                  )}
                </div>
              </div>
              <div>
                <p className="text-xs uppercase text-muted-foreground mb-2">Outputs</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => fanOut('ToggleStream', {})}>
                    <Radio className="h-3.5 w-3.5 mr-1" /> Toggle Stream
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => fanOut('ToggleRecord', {})}>
                    <RadioReceiver className="h-3.5 w-3.5 mr-1" /> Toggle Record
                  </Button>
                </div>
              </div>
              {lastResult ? (
                <div className="text-sm border-t pt-3">
                  <p className="font-medium">{lastResult.action}</p>
                  <p className="text-green-600">ok: {lastResult.ok.length}</p>
                  {lastResult.failed.length > 0 ? (
                    <ul className="text-destructive text-xs mt-1">
                      {lastResult.failed.map((f) => (
                        <li key={f.connId}>
                          {f.connId.slice(0, 8)}... — {f.code}: {f.message}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tile grid */}
      {tiles.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground">
            No connections configured. Add one on the Connections page.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {tiles.map(({ conn, live }) => (
            <InstanceTile
              key={conn.id}
              conn={conn}
              live={live}
              selected={selected.has(conn.id)}
              onToggle={() => toggle(conn.id)}
              onSwitchScene={(name) =>
                ws.dispatch('SetCurrentProgramScene', [conn.id], { sceneName: name })
              }
              onMute={(inputName, muted) =>
                ws.dispatch('SetInputMute', [conn.id], { inputName, muted })
              }
              onVolume={(inputName, volumeMul) =>
                ws.dispatch('SetInputVolume', [conn.id], { inputName, volumeMul })
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function InstanceTile({
  conn,
  live,
  selected,
  onToggle,
  onSwitchScene,
  onMute,
  onVolume,
}: {
  conn: ConnectionConfig;
  live: InstanceState | undefined;
  selected: boolean;
  onToggle: () => void;
  onSwitchScene: (name: string) => void;
  onMute: (inputName: string, muted: boolean) => void;
  onVolume: (inputName: string, volumeMul: number) => void;
}): JSX.Element {
  const status = live?.status ?? 'disconnected';
  const statusColor =
    status === 'connected'
      ? 'text-green-600'
      : status === 'connecting'
        ? 'text-amber-600'
        : status === 'auth_failed'
          ? 'text-destructive'
          : 'text-muted-foreground';

  return (
    <Card className={cn(selected && 'ring-2 ring-primary')}>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="grid gap-1">
            <CardTitle className="flex items-center gap-2">
              <Checkbox checked={selected} onCheckedChange={onToggle} aria-label="Select tile" />
              {conn.name}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {conn.host}:{conn.port}
            </p>
          </div>
          <span className={cn('text-xs font-medium', statusColor)}>{status}</span>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        {live ? (
          <>
            <div>
              <p className="text-xs uppercase text-muted-foreground mb-1">Program</p>
              <p className="font-medium text-sm">{live.currentProgramScene ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground mb-1">Scenes</p>
              <div className="flex flex-wrap gap-1">
                {live.scenes.length === 0 ? (
                  <span className="text-xs text-muted-foreground">no scenes loaded</span>
                ) : (
                  live.scenes.map((s) => (
                    <Button
                      key={s.name}
                      size="sm"
                      variant={s.name === live.currentProgramScene ? 'default' : 'outline'}
                      onClick={() => onSwitchScene(s.name)}
                    >
                      {s.name}
                    </Button>
                  ))
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-3 text-xs">
              <span>
                stream: {live.outputs.streaming.active ? '🔴 on' : 'off'}
              </span>
              <span>
                record: {live.outputs.recording.active ? '🔴 on' : 'off'}
              </span>
            </div>
            <AudioMixer inputs={live.inputs} onMute={onMute} onVolume={onVolume} />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No live state — backend not connected to this OBS yet.</p>
        )}
      </CardContent>
    </Card>
  );
}
