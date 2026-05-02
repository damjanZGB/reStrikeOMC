import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function SetupPage(): JSX.Element {
  const qc = useQueryClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const setup = useMutation({
    mutationFn: () => api.setup(username, password),
    onSuccess: async () => {
      await api.login(username, password);
      await qc.invalidateQueries({ queryKey: ['me'] });
    },
  });

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>First-run setup</CardTitle>
          <CardDescription>
            No users exist yet. Create the first operator account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              setup.mutate();
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                minLength={1}
                maxLength={64}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password (min 8)</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>
            {setup.isError ? (
              <p className="text-sm text-destructive">
                Setup failed: {(setup.error as Error).message}
              </p>
            ) : null}
            <Button type="submit" disabled={setup.isPending}>
              {setup.isPending ? 'Creating...' : 'Create account'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
