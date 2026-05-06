import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConnectionConfig, ConnectionInput } from '@restrike/shared';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
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
import { Trash2, Wifi, Radar, Pencil } from 'lucide-react';

interface AddFormState {
  name: string;
  host: string;
  port: string;
  password: string;
}

const emptyAdd: AddFormState = { name: '', host: '', port: '4455', password: '' };

interface EditFormState {
  name: string;
  host: string;
  port: string;
  password: string;
  clearPassword: boolean;
}

function toEditForm(c: ConnectionConfig): EditFormState {
  return {
    name: c.name,
    host: c.host,
    port: String(c.port),
    password: '',
    clearPassword: false,
  };
}

export function ConnectionsPage(): JSX.Element {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState<AddFormState>(emptyAdd);
  const [editing, setEditing] = useState<ConnectionConfig | null>(null);
  const [editForm, setEditForm] = useState<EditFormState | null>(null);
  const [testStatus, setTestStatus] = useState<Record<string, string>>({});
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [discoverPort, setDiscoverPort] = useState<string>('4455');

  const list = useQuery({ queryKey: ['connections'], queryFn: api.listConnections });

  const create = useMutation({
    mutationFn: (input: ConnectionInput) => api.createConnection(input),
    onSuccess: async () => {
      setAddOpen(false);
      setAddForm(emptyAdd);
      await qc.invalidateQueries({ queryKey: ['connections'] });
    },
  });

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<ConnectionInput> }) =>
      api.updateConnection(id, patch),
    onSuccess: async () => {
      setEditing(null);
      setEditForm(null);
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
    mutationFn: (port: number) => api.discover(port),
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
              if (v && !discover.data) {
                discover.mutate(Number(discoverPort) || 4455);
              }
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
                  Scans your local subnet for hosts responding on the given port.
                  Defaults to OBS-WebSocket's standard 4455 — change it if your
                  instances use a different port.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-2">
                <Label htmlFor="discover-port">Port</Label>
                <div className="flex gap-2">
                  <Input
                    id="discover-port"
                    type="number"
                    min={1}
                    max={65535}
                    value={discoverPort}
                    onChange={(e) => setDiscoverPort(e.target.value)}
                  />
                  <Button
                    onClick={() => discover.mutate(Number(discoverPort) || 4455)}
                    disabled={discover.isPending}
                  >
                    {discover.isPending ? 'Scanning...' : 'Scan'}
                  </Button>
                </div>
              </div>
              {discover.isPending ? (
                <p className="text-sm text-muted-foreground">
                  Probing 254 hosts in parallel — this typically takes 2-5 seconds.
                </p>
              ) : discover.isError ? (
                <p className="text-sm text-destructive">
                  {(discover.error as Error).message}
                </p>
              ) : discover.data && discover.data.hosts.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No hosts responded on port {discoverPort}. Make sure
                  obs-websocket is enabled and reachable, or try a different port.
                </p>
              ) : discover.data ? (
                <ul className="grid gap-2">
                  {discover.data.hosts.map((h) => (
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
                          setAddForm({
                            name: `OBS @ ${h.host}`,
                            host: h.host,
                            port: String(h.port),
                            password: '',
                          });
                          setDiscoverOpen(false);
                          setAddOpen(true);
                        }}
                      >
                        Add
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </DialogContent>
          </Dialog>

          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button>Add connection</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add OBS connection</DialogTitle>
                <DialogDescription>
                  Each OBS instance can run on its own host, port, and password.
                  Default port is 4455 (OBS-WebSocket convention) but anything
                  1-65535 works.
                </DialogDescription>
              </DialogHeader>
              <form
                className="grid gap-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  create.mutate({
                    name: addForm.name,
                    host: addForm.host,
                    port: Number(addForm.port),
                    password: addForm.password || undefined,
                  });
                }}
              >
                <div className="grid gap-2">
                  <Label htmlFor="add-name">Name</Label>
                  <Input
                    id="add-name"
                    value={addForm.name}
                    onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="add-host">Host</Label>
                  <Input
                    id="add-host"
                    placeholder="192.168.1.50"
                    value={addForm.host}
                    onChange={(e) => setAddForm({ ...addForm, host: e.target.value })}
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="add-port">Port</Label>
                  <Input
                    id="add-port"
                    type="number"
                    min={1}
                    max={65535}
                    value={addForm.port}
                    onChange={(e) => setAddForm({ ...addForm, port: e.target.value })}
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="add-password">Password (optional)</Label>
                  <Input
                    id="add-password"
                    type="password"
                    value={addForm.password}
                    onChange={(e) =>
                      setAddForm({ ...addForm, password: e.target.value })
                    }
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
              onEdit={() => {
                setEditing(c);
                setEditForm(toEditForm(c));
              }}
            />
          ))}
        </div>
      )}

      {/* Edit dialog (controlled, opens for the connection in `editing`) */}
      <Dialog
        open={editing !== null}
        onOpenChange={(v) => {
          if (!v) {
            setEditing(null);
            setEditForm(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit connection</DialogTitle>
            <DialogDescription>
              Change host, port, or password. Renames don&apos;t disrupt the live
              socket; changing host/port/password reconnects with the new config.
            </DialogDescription>
          </DialogHeader>
          {editing && editForm ? (
            <form
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                const patch: Partial<ConnectionInput> = {};
                if (editForm.name !== editing.name) patch.name = editForm.name;
                if (editForm.host !== editing.host) patch.host = editForm.host;
                const newPort = Number(editForm.port);
                if (newPort !== editing.port) patch.port = newPort;
                if (editForm.clearPassword) {
                  patch.password = '';
                } else if (editForm.password.length > 0) {
                  patch.password = editForm.password;
                }
                update.mutate({ id: editing.id, patch });
              }}
            >
              <div className="grid gap-2">
                <Label htmlFor="edit-name">Name</Label>
                <Input
                  id="edit-name"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-host">Host</Label>
                <Input
                  id="edit-host"
                  value={editForm.host}
                  onChange={(e) => setEditForm({ ...editForm, host: e.target.value })}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-port">Port</Label>
                <Input
                  id="edit-port"
                  type="number"
                  min={1}
                  max={65535}
                  value={editForm.port}
                  onChange={(e) => setEditForm({ ...editForm, port: e.target.value })}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-password">
                  Password{' '}
                  <span className="text-xs text-muted-foreground font-normal">
                    {editing.hasPassword
                      ? '(leave blank to keep current)'
                      : '(optional)'}
                  </span>
                </Label>
                <Input
                  id="edit-password"
                  type="password"
                  placeholder={editing.hasPassword ? '••••••••' : ''}
                  value={editForm.password}
                  onChange={(e) =>
                    setEditForm({ ...editForm, password: e.target.value })
                  }
                  disabled={editForm.clearPassword}
                />
                {editing.hasPassword ? (
                  <label className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                    <Checkbox
                      checked={editForm.clearPassword}
                      onCheckedChange={(v) =>
                        setEditForm({
                          ...editForm,
                          clearPassword: v === true,
                          password: v === true ? '' : editForm.password,
                        })
                      }
                    />
                    Remove password (this OBS no longer requires authentication)
                  </label>
                ) : null}
              </div>
              {update.isError ? (
                <p className="text-sm text-destructive">
                  {(update.error as Error).message}
                </p>
              ) : null}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditing(null);
                    setEditForm(null);
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={update.isPending}>
                  {update.isPending ? 'Saving...' : 'Save'}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ConnectionCard({
  conn,
  testStatus,
  onTest,
  onDelete,
  onEdit,
}: {
  conn: ConnectionConfig;
  testStatus: string | undefined;
  onTest: () => void;
  onDelete: () => void;
  onEdit: () => void;
}): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>{conn.name}</span>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" onClick={onEdit} aria-label="Edit">
              <Pencil className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={onDelete} aria-label="Delete">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
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
                  ? 'text-state-ok'
                  : testStatus === 'auth_failed'
                    ? 'text-state-warn'
                    : 'text-state-bad'
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
