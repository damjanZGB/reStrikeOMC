import { OBSWebSocket } from 'obs-websocket-js';
import { EventEmitter } from 'node:events';
import type { ConnectionStatus } from '@restrike/shared';

export interface ConnectionTarget {
  id: string;
  host: string;
  port: number;
  password: string | null;
}

interface Slot {
  target: ConnectionTarget;
  client: OBSWebSocket;
  status: ConnectionStatus;
  reconnectTimer: NodeJS.Timeout | null;
  reconnectAttempt: number;
  closing: boolean;
}

export interface StatusEvent {
  connId: string;
  status: ConnectionStatus;
  reason?: string;
}

export interface SnapshotEvent {
  connId: string;
  currentProgramScene: string | null;
  currentPreviewScene: string | null;
  scenes: Array<{ name: string; index: number }>;
  inputs: Array<{ name: string; kind: string }>;
}

export type ConnectionManagerEvents = {
  status: [StatusEvent];
  obsEvent: [{ connId: string; eventType: string; eventData: unknown }];
  snapshot: [SnapshotEvent];
};

export class ConnectionManager extends EventEmitter {
  private readonly slots = new Map<string, Slot>();

  override on<K extends keyof ConnectionManagerEvents>(
    event: K,
    listener: (...args: ConnectionManagerEvents[K]) => void
  ): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  override emit<K extends keyof ConnectionManagerEvents>(
    event: K,
    ...args: ConnectionManagerEvents[K]
  ): boolean {
    return super.emit(event, ...args);
  }

  async add(target: ConnectionTarget): Promise<void> {
    if (this.slots.has(target.id)) return;
    const slot: Slot = {
      target,
      client: new OBSWebSocket(),
      status: 'disconnected',
      reconnectTimer: null,
      reconnectAttempt: 0,
      closing: false,
    };
    this.slots.set(target.id, slot);
    this.wireClient(slot);
    this.setStatus(slot, 'connecting');
    void this.openOnce(slot);
  }

  private wireClient(slot: Slot): void {
    slot.client.on('ConnectionClosed', () => {
      if (slot.closing) return;
      if (slot.status !== 'auth_failed') {
        this.setStatus(slot, 'disconnected');
        this.scheduleReconnect(slot);
      }
    });
    slot.client.on('ConnectionError', () => {
      // surfaced via ConnectionClosed too — no action here
    });
    slot.client.on('Identified', () => {
      slot.reconnectAttempt = 0;
      this.setStatus(slot, 'connected');
      void this.fetchSnapshot(slot);
    });
  }

  private async fetchSnapshot(slot: Slot): Promise<void> {
    try {
      const [sceneList, inputList] = await Promise.all([
        slot.client.call('GetSceneList'),
        slot.client.call('GetInputList'),
      ]);
      this.emit('snapshot', {
        connId: slot.target.id,
        currentProgramScene: sceneList.currentProgramSceneName ?? null,
        currentPreviewScene: sceneList.currentPreviewSceneName ?? null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        scenes: sceneList.scenes.map((s: any) => ({
          name: String(s.sceneName),
          index: Number(s.sceneIndex),
        })),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        inputs: inputList.inputs.map((i: any) => ({
          name: String(i.inputName),
          kind: String(i.inputKind),
        })),
      });
    } catch {
      // snapshot fetch errors are non-fatal — coalescer will retry on next event
    }
  }

  private async openOnce(slot: Slot): Promise<void> {
    const url = `ws://${slot.target.host}:${slot.target.port}`;
    try {
      await slot.client.connect(url, slot.target.password ?? undefined);
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code === 4009) {
        this.setStatus(slot, 'auth_failed', 'invalid password');
        return;
      }
      this.setStatus(slot, 'disconnected', String(err));
      this.scheduleReconnect(slot);
    }
  }

  private scheduleReconnect(slot: Slot): void {
    if (slot.closing || slot.status === 'auth_failed') return;
    if (slot.reconnectTimer) return;
    slot.reconnectAttempt += 1;
    const baseMs = Math.min(30_000, 1000 * 2 ** (slot.reconnectAttempt - 1));
    const jitter = Math.floor(Math.random() * 250);
    slot.reconnectTimer = setTimeout(() => {
      slot.reconnectTimer = null;
      this.setStatus(slot, 'connecting');
      void this.openOnce(slot);
    }, baseMs + jitter);
  }

  private setStatus(slot: Slot, status: ConnectionStatus, reason?: string): void {
    if (slot.status === status) return;
    slot.status = status;
    this.emit('status', { connId: slot.target.id, status, reason });
  }

  getStatus(id: string): ConnectionStatus | null {
    return this.slots.get(id)?.status ?? null;
  }

  async waitForStatus(
    id: string,
    status: ConnectionStatus,
    timeoutMs: number
  ): Promise<void> {
    const slot = this.slots.get(id);
    if (!slot) throw new Error(`unknown conn ${id}`);
    if (slot.status === status) return;
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => {
        this.off('status', onStatus);
        reject(new Error(`timeout waiting for ${status}, last=${slot.status}`));
      }, timeoutMs);
      const onStatus = (e: StatusEvent): void => {
        if (e.connId === id && e.status === status) {
          clearTimeout(t);
          this.off('status', onStatus);
          resolve();
        }
      };
      this.on('status', onStatus);
    });
  }

  async call(
    connId: string,
    requestType: string,
    requestData: Record<string, unknown>
  ): Promise<unknown> {
    const slot = this.slots.get(connId);
    if (!slot) throw new Error(`unknown conn ${connId}`);
    if (slot.status !== 'connected') {
      throw new Error(`conn ${connId} not connected (status=${slot.status})`);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return slot.client.call(requestType as any, requestData as any);
  }

  async remove(id: string): Promise<void> {
    const slot = this.slots.get(id);
    if (!slot) return;
    slot.closing = true;
    if (slot.reconnectTimer) clearTimeout(slot.reconnectTimer);
    try {
      await slot.client.disconnect();
    } catch {
      // ignore
    }
    this.slots.delete(id);
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.slots.keys()].map((id) => this.remove(id)));
  }
}
