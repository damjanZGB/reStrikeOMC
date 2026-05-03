import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConnectionConfig, ConnectionInput } from '@restrike/shared';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Trash2, Wifi, Radar } from 'lucide-react';

interface FormState {
  name: string;
  host: string;
  port: string;
  password: string;
}

const empty: FormState = { name: '', host: '', port: '4455', password: '' };

export function ConnectionsPage(): JSX.Element {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(empty);
  const [testStatus, setTestStatus] = useState<Record<string, string>>({});
  const [discoverOpen, setDiscoverOpen] = useState(false);

  const list = useQuery({ queryKey: ['connections'], queryFn: api.listConnections });

  const create = useMutation({
    mutationFn: (input: ConnectionInput) => api.createConnection(input),
    onSuccess: async () => {
      setOpen(false);
      setForm(empty);
      await qc.invalidateQueries({ queryKey: ['connections'] });
    },
  });

  const del = useMutation({
    mutationFn: (id: string) => api.deleteConnection(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['connections'] }),
  });

  const probe = useMutation({
    mutationFn: (id: string) => api.testConnection(id),
    onSuccess: (data, id) =>
      setTestStatus((prev) => ({ ...prev, [id]: data.status })),
    onError: (_err, id) =>
      setTestStatus((prev) => ({ ...prev, [id]: 'error' })),
  });

  const discover = useMutation({
    mutationFn: () => api.discover(4455),
  });

  return (
    <div className="grid gap-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Connections</h1>
        <div className="flex gap-2">
          <Dialog
            open={discoverOpen}
            onOpenChange={(v) => {
              setDiscoverOpen(v);
              if (v && !discover.data) discover.mutate();
            }}
          >
            <DialogTrigger asChild>
              <Button variant="outline">
                <Radar className="h-4 w-4 mr-2" />
                Discover LAN
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Discover OBS instances</DialogTitle>
                <DialogDescription>
                  Scans your local subnet for hosts responding on port 4455. May take a few seconds.
                </DialogDescription>
              </DialogHeader>
              {discover.isPending ? (
                <p className="text-sm text-muted-foreground">Scanning...</p>
              ) : discover.isError ? (
                <p className="text-sm text-destructive">
                  {(discover.error as Error).message}
                </p>
              ) : discover.data && discover.data.hosts.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No hosts responded. Make sure obs-websocket is enabled and reachable.
                </p>
              ) : (
                <ul className="grid gap-2">
                  {discover.data?.hosts.map((h) => (
                    <li
                      key={`${h.host}:${h.port}`}
                      className="flex items-center justify-between border rounded-md px-3 py-2"
                    >
                      <span className="font-mono text-sm">
                        {h.host}:{h.port}
                      </span>
                      <Button
                        size="sm"
                        onClick={() => {
                          setForm({
                            name: `OBS @ ${h.host}`,
                            host: h.host,
                            port: String(h.port),
                            password: '',
                          });
                          setDiscoverOpen(false);
                          setOpen(true);
                        }}
                      >
                        Add
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => discover.mutate()}
                  disabled={discover.isPending}
                >
                  {discover.isPending ? 'Scanning...' : 'Re-scan'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>Add connection</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add OBS connection</DialogTitle>
              <DialogDescription>Reach an OBS instance over the LAN.</DialogDescription>
            </DialogHeader>
            <form
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                create.mutate({
                  name: form.name,
                  host: form.host,
                  port: Number(form.port),
                  password: form.password || undefined,
                });
              }}
            >
              <div className="grid gap-2">
                <Label htmlFor="conn-name">Name</Label>
                <Input
                  id="conn-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="conn-host">Host</Label>
                <Input
                  id="conn-host"
                  placeholder="192.168.1.50"
                  value={form.host}
                  onChange={(e) => setForm({ ...form, host: e.target.value })}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="conn-port">Port</Label>
                <Input
                  id="conn-port"
                  type="number"
                  min={1}
                  max={65535}
                  value={form.port}
                  onChange={(e) => setForm({ ...form, port: e.target.value })}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="conn-password">Password (optional)</Label>
                <Input
                  id="conn-password"
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              </div>
              {create.isError ? (
                <p className="text-sm text-destructive">
                  {(create.error as Error).message}
                </p>
              ) : null}
              <DialogFooter>
                <Button type="submit" disabled={create.isPending}>
                  {create.isPending ? 'Adding...' : 'Add'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {list.isLoading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : list.isError ? (
        <p className="text-destructive">Failed to load connections.</p>
      ) : list.data && list.data.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground">
            No connections yet. Add one to get started.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {list.data?.map((c) => (
            <ConnectionCard
              key={c.id}
              conn={c}
              testStatus={testStatus[c.id]}
              onTest={() => probe.mutate(c.id)}
              onDelete={() => del.mutate(c.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ConnectionCard({
  conn,
  testStatus,
  onTest,
  onDelete,
}: {
  conn: ConnectionConfig;
  testStatus: string | undefined;
  onTest: () => void;
  onDelete: () => void;
}): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>{conn.name}</span>
          <Button variant="ghost" size="icon" onClick={onDelete} aria-label="Delete">
            <Trash2 className="h-4 w-4" />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        <div className="text-muted-foreground">
          {conn.host}:{conn.port}
          {conn.hasPassword ? ' · 🔒 password set' : ''}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={onTest}>
            <Wifi className="h-3.5 w-3.5 mr-1" />
            Test
          </Button>
          {testStatus ? (
            <span
              className={
                testStatus === 'ok'
                  ? 'text-green-600'
                  : testStatus === 'auth_failed'
                    ? 'text-amber-600'
                    : 'text-destructive'
              }
            >
              {testStatus}
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
