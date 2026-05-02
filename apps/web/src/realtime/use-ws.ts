import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import {
  ServerMessageSchema,
  type InstanceState,
  type InstanceStateDiff,
  type ServerMessage,
  type ClientMessage,
  type PerTargetFailure,
} from '@restrike/shared';

interface WsState {
  connected: boolean;
  states: Record<string, InstanceState>;
  pending: Map<string, (result: { ok: string[]; failed: PerTargetFailure[] }) => void>;
  setConnected: (v: boolean) => void;
  applySnapshot: (states: InstanceState[]) => void;
  applyDiff: (diff: InstanceStateDiff) => void;
}

export const useWsStore = create<WsState>((set) => ({
  connected: false,
  states: {},
  pending: new Map(),
  setConnected: (v) => set({ connected: v }),
  applySnapshot: (states) =>
    set(() => {
      const next: Record<string, InstanceState> = {};
      for (const s of states) next[s.connId] = s;
      return { states: next };
    }),
  applyDiff: (diff) =>
    set((prev) => {
      const current = prev.states[diff.connId];
      if (!current) return prev;
      return {
        states: {
          ...prev.states,
          [diff.connId]: { ...current, ...diff, connId: diff.connId },
        },
      };
    }),
}));

export interface UseWsResult {
  connected: boolean;
  send: (msg: ClientMessage) => void;
  dispatch: (
    action: string,
    targets: string[],
    payload: Record<string, unknown>
  ) => Promise<{ ok: string[]; failed: PerTargetFailure[] }>;
}

export function useWs(): UseWsResult {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnectedLocal] = useState(false);
  const setConnected = useWsStore((s) => s.setConnected);
  const applySnapshot = useWsStore((s) => s.applySnapshot);
  const applyDiff = useWsStore((s) => s.applyDiff);

  useEffect(() => {
    let stopped = false;
    let attempt = 0;
    const pending = new Map<
      string,
      (result: { ok: string[]; failed: PerTargetFailure[] }) => void
    >();

    function open(): void {
      if (stopped) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
      wsRef.current = ws;
      ws.onopen = () => {
        attempt = 0;
        setConnected(true);
        setConnectedLocal(true);
      };
      ws.onclose = () => {
        setConnected(false);
        setConnectedLocal(false);
        if (stopped) return;
        attempt += 1;
        const delay = Math.min(15_000, 1000 * 2 ** Math.min(4, attempt - 1));
        setTimeout(open, delay);
      };
      ws.onerror = () => {
        // close handler will follow
      };
      ws.onmessage = (ev) => {
        let parsed: ServerMessage;
        try {
          parsed = ServerMessageSchema.parse(JSON.parse(String(ev.data)));
        } catch {
          return;
        }
        if (parsed.type === 'state.snapshot') applySnapshot(parsed.states);
        else if (parsed.type === 'state.diff') applyDiff(parsed.diff);
        else if (parsed.type === 'cmd.result') {
          const handler = pending.get(parsed.id);
          if (handler) {
            pending.delete(parsed.id);
            handler({ ok: parsed.ok, failed: parsed.failed });
          }
        }
      };
      // expose pending map on the socket for dispatch closures
      (ws as WebSocket & { __pending?: typeof pending }).__pending = pending;
    }

    open();
    return () => {
      stopped = true;
      wsRef.current?.close();
    };
  }, [setConnected, applySnapshot, applyDiff]);

  function send(msg: ClientMessage): void {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  function dispatch(
    action: string,
    targets: string[],
    payload: Record<string, unknown>
  ): Promise<{ ok: string[]; failed: PerTargetFailure[] }> {
    return new Promise((resolve, reject) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'));
        return;
      }
      const id = `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const pending = (ws as WebSocket & { __pending?: Map<string, (r: { ok: string[]; failed: PerTargetFailure[] }) => void> }).__pending;
      if (!pending) {
        reject(new Error('pending map missing'));
        return;
      }
      pending.set(id, resolve);
      const timeout = setTimeout(() => {
        if (pending.delete(id)) reject(new Error('cmd timeout'));
      }, 10_000);
      const wrapped = (r: { ok: string[]; failed: PerTargetFailure[] }): void => {
        clearTimeout(timeout);
        resolve(r);
      };
      pending.set(id, wrapped);
      ws.send(
        JSON.stringify({
          type: 'cmd',
          id,
          action,
          targets,
          payload,
        } satisfies ClientMessage)
      );
    });
  }

  return { connected, send, dispatch };
}
