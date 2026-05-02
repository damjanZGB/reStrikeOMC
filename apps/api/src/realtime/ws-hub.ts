import { WebSocketServer, type WebSocket } from 'ws';
import type { FastifyInstance } from 'fastify';
import {
  ClientMessageSchema,
  type ServerMessage,
  type InstanceState,
  type InstanceStateDiff,
  type PerTargetFailure,
} from '@restrike/shared';
import { SESSION_COOKIE_NAME } from '../routes/auth.js';
import type { StateStore } from '../state/state-store.js';

export interface ClientConn {
  ws: WebSocket;
  userId: string;
}

export interface DispatchInput {
  userId: string;
  action: string;
  targets: string[];
  payload: Record<string, unknown>;
}

export interface DispatchResult {
  ok: string[];
  failed: PerTargetFailure[];
}

export interface CommandBusLike {
  dispatch(input: DispatchInput): Promise<DispatchResult>;
}

export class WsHub {
  private readonly wss: WebSocketServer;
  private readonly conns = new Set<ClientConn>();

  constructor(
    private readonly server: FastifyInstance,
    private readonly store?: StateStore,
    private readonly bus?: CommandBusLike
  ) {
    this.wss = new WebSocketServer({ noServer: true });
    server.server.on('upgrade', (req, socket, head) => {
      if (req.url !== '/ws') return;
      const userId = this.authenticateUpgrade(req.headers.cookie ?? '');
      if (!userId) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.onAuthenticatedConnection(ws, userId);
      });
    });
  }

  private onAuthenticatedConnection(ws: WebSocket, userId: string): void {
    const conn: ClientConn = { ws, userId };
    this.conns.add(conn);
    ws.on('close', () => this.conns.delete(conn));

    this.send(ws, {
      type: 'state.snapshot',
      states: this.store?.snapshot() ?? [],
    });

    ws.on('message', (raw) => this.onMessage(conn, raw as Buffer));
  }

  private onMessage(conn: ClientConn, raw: Buffer): void {
    let parsed;
    try {
      parsed = ClientMessageSchema.parse(JSON.parse(raw.toString()));
    } catch {
      this.send(conn.ws, { type: 'error', message: 'invalid_message' });
      return;
    }
    if (parsed.type === 'sync') {
      this.send(conn.ws, {
        type: 'state.snapshot',
        states: this.store?.snapshot() ?? [],
      });
      return;
    }
    if (parsed.type === 'cmd') {
      if (!this.bus) {
        this.send(conn.ws, { type: 'error', message: 'command_bus_unavailable' });
        return;
      }
      void this.bus
        .dispatch({
          userId: conn.userId,
          action: parsed.action,
          targets: parsed.targets,
          payload: parsed.payload,
        })
        .then((result: DispatchResult) => {
          this.send(conn.ws, {
            type: 'cmd.result',
            id: parsed.id,
            ok: result.ok,
            failed: result.failed,
          });
        })
        .catch((err: Error) => {
          this.send(conn.ws, {
            type: 'error',
            message: String(err.message ?? err),
          });
        });
      return;
    }
    if (parsed.type === 'selection.update') {
      // selection persistence is a Plan 2 concern
      return;
    }
  }

  private authenticateUpgrade(cookieHeader: string): string | null {
    const cookies = Object.fromEntries(
      cookieHeader.split(/;\s*/).map((p) => {
        const idx = p.indexOf('=');
        return idx === -1 ? [p, ''] : [p.slice(0, idx), p.slice(idx + 1)];
      })
    );
    const raw = cookies[SESSION_COOKIE_NAME];
    if (!raw) return null;
    const unsigned = this.server.unsignCookie(decodeURIComponent(raw));
    if (!unsigned.valid || !unsigned.value) return null;
    const sess = this.server.sessions.findValid(unsigned.value);
    return sess?.userId ?? null;
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    ws.send(JSON.stringify(msg));
  }

  broadcastDiff(diff: InstanceStateDiff): void {
    const msg: ServerMessage = { type: 'state.diff', diff };
    for (const c of this.conns) this.send(c.ws, msg);
  }

  broadcastSnapshot(states: InstanceState[]): void {
    const msg: ServerMessage = { type: 'state.snapshot', states };
    for (const c of this.conns) this.send(c.ws, msg);
  }

  clients(): readonly ClientConn[] {
    return Array.from(this.conns);
  }

  close(): void {
    for (const c of this.conns) c.ws.close();
    this.wss.close();
  }
}
