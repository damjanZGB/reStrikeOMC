import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { AuthFailedError, type ConnectOpts, type IObsClient } from './types.js';
import { computeV4Auth, type V4Frame, isV4Event, isV4Response } from './v4-protocol.js';
import {
  translateEvent,
  translateRequest,
  translateResponse,
  WRITE_COMMANDS,
  type SceneItemLookup,
} from './v4-translate.js';

interface PendingRequest {
  resolve: (value: Record<string, unknown>) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
  internalName: string;
}

type EventCb = (data?: unknown) => void;

const REQUEST_TIMEOUT_MS = 8_000;
const VCAM_POLL_INTERVAL_MS = 5_000;

/**
 * Hand-rolled obs-websocket v4 client. Translates internal v5-vocab requests
 * and events at its boundary so the rest of the codebase stays unaware of
 * which protocol speaks to OBS.
 */
export class ObsV4Client implements IObsClient {
  private ws: WebSocket | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly listeners = new Map<string, EventCb[]>();
  // Map<sceneName, Map<sceneItemId, sceneItemName>> — required by v4's
  // SetSceneItemProperties which addresses items by name, not the numeric id
  // the rest of our code uses (see design doc, gap fix #1).
  private readonly sceneItems = new Map<string, Map<number, string>>();
  private recordPaused = false;
  private vcamActive = false;
  private vcamPollTimer: NodeJS.Timeout | null = null;
  private closing = false;

  async connect(url: string, password: string | undefined, _opts: ConnectOpts): Promise<void> {
    if (this.ws) throw new Error('already connected');
    this.closing = false;
    const ws = new WebSocket(url);
    this.ws = ws;

    await new Promise<void>((resolve, reject) => {
      const onOpen = (): void => {
        ws.off('error', onError);
        resolve();
      };
      const onError = (err: Error): void => {
        ws.off('open', onOpen);
        reject(err);
      };
      ws.once('open', onOpen);
      ws.once('error', onError);
    });

    ws.on('message', (raw) => this.handleFrame(raw));
    // P0-1: bind the close handler to *this specific* WebSocket. Without
    // the binding, a deferred 'close' event from a previously-disconnected
    // socket would still reach handleClose() and clobber the freshly
    // re-connected this.ws. The handler now compares its captured socket
    // against the current this.ws and bails when they differ.
    ws.on('close', () => this.handleClose(ws));
    // P1-9: forward the underlying ws error so the manager has something
    // to log. Without the payload, all the operator sees is the empty
    // ConnectionError event.
    ws.on('error', (err: Error) => this.emitLifecycle('ConnectionError', err));

    await this.runAuth(password);

    // Background snapshot bookkeeping for the gap fixes — these don't block
    // the Identified emit. If they fail, we still report identified; the
    // manager retries fetchSnapshot anyway.
    void this.primeSceneItemCache();
    void this.primeVcamPoll();

    this.emitLifecycle('Identified');
  }

  async disconnect(): Promise<void> {
    this.closing = true;
    if (this.vcamPollTimer) {
      clearInterval(this.vcamPollTimer);
      this.vcamPollTimer = null;
    }
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      try {
        ws.close();
      } catch {
        // ignore
      }
    }
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('disconnected'));
    }
    this.pending.clear();
  }

  async call(requestType: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    const lookup: SceneItemLookup = {
      itemNameForId: (sceneName, id) => this.sceneItems.get(sceneName)?.get(id) ?? null,
    };
    let translated;
    try {
      translated = translateRequest(requestType, payload, {
        sceneItems: lookup,
        recordPaused: this.recordPaused,
      });
    } catch (err) {
      // Gap 1 recovery: scene-item cache miss for SetSceneItemEnabled. Refresh
      // the cache for the named scene and retry once before bubbling out.
      if (
        requestType === 'SetSceneItemEnabled' &&
        err instanceof Error &&
        err.message.startsWith('v4 scene-item lookup miss')
      ) {
        const sceneName = String(payload.sceneName ?? '');
        await this.refreshSceneItemsFor(sceneName);
        translated = translateRequest(requestType, payload, {
          sceneItems: lookup,
          recordPaused: this.recordPaused,
        });
      } else {
        throw err;
      }
    }

    const raw = await this.rawV4Call(requestType, translated.v4Type, translated.v4Payload);
    const reshaped = translateResponse(requestType, raw);
    if (reshaped !== null) return reshaped;
    // P1-7: translateResponse returns null when the v4 response is just
    // `{status:'ok', message-id}` — i.e. a write command. Validate
    // against the explicit WRITE_COMMANDS set rather than blindly
    // returning the raw v4 frame: a future internal command added to
    // translateRequest without a translateResponse case would otherwise
    // leak v4-shaped keys (`message-id`, `status`) into callers that
    // expect v5-shaped responses.
    if (!WRITE_COMMANDS.has(requestType)) {
      throw new Error(
        'v4 response not reshaped for internal command: ' + requestType
      );
    }
    return undefined;
  }

  on(event: 'Identified' | 'ConnectionClosed', cb: () => void): void;
  on(event: 'ConnectionError', cb: (err?: Error) => void): void;
  on(event: string, cb: (data: unknown) => void): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, cb: (...args: any[]) => void): void {
    const arr = this.listeners.get(event) ?? [];
    arr.push(cb as EventCb);
    this.listeners.set(event, arr);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  off(event: string, cb: (...args: any[]) => void): void {
    const arr = this.listeners.get(event);
    if (!arr) return;
    const idx = arr.indexOf(cb as EventCb);
    if (idx >= 0) arr.splice(idx, 1);
  }

  private emit(event: string, data?: unknown): void {
    const arr = this.listeners.get(event);
    if (!arr) return;
    for (const cb of arr) {
      try {
        cb(data);
      } catch {
        // listener errors must not break the dispatcher
      }
    }
  }

  /**
   * P1-9: lifecycle events accept an optional Error so ConnectionError
   * carries forensic detail to listeners. Identified/ConnectionClosed
   * ignore the argument.
   */
  private emitLifecycle(
    event: 'Identified' | 'ConnectionClosed' | 'ConnectionError',
    err?: Error
  ): void {
    this.emit(event, err);
  }

  private handleClose(socket: WebSocket): void {
    // P0-1: bail when this close event belongs to an *old* socket that was
    // already replaced by a subsequent connect(). this.ws now points at the
    // new socket and the rest of this handler would otherwise null it out
    // and drain the new socket's pending requests.
    const isCurrent = this.ws === socket;
    if (this.vcamPollTimer && isCurrent) {
      clearInterval(this.vcamPollTimer);
      this.vcamPollTimer = null;
    }
    if (!isCurrent) return;
    // P0-4: skip the drain when disconnect() is already running. disconnect()
    // synchronously rejects every pending entry then calls ws.close() — the
    // resulting 'close' event re-enters here, and we'd iterate the (already
    // cleared) map a second time, churning through stale Promise rejects.
    if (!this.closing) {
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error('connection closed'));
      }
      this.pending.clear();
      this.ws = null;
      this.emitLifecycle('ConnectionClosed');
    }
  }

  private handleFrame(raw: unknown): void {
    let frame: V4Frame;
    try {
      const text = typeof raw === 'string' ? raw : (raw as Buffer).toString('utf-8');
      frame = JSON.parse(text) as V4Frame;
    } catch {
      // P0-3: surface parse failures as a lifecycle ConnectionError so the
      // operator has a forensic trail. The pending request (if any) waiting
      // for this frame still times out at 8s, but at least now it's not
      // silent — the manager logs the error and the symptom isn't an
      // opaque "v4 request timed out: <type>" 8 seconds after the fact.
      this.emitLifecycle('ConnectionError', new Error('malformed v4 frame'));
      return;
    }
    if (isV4Event(frame)) {
      this.handleEvent(frame as unknown as Record<string, unknown>);
      return;
    }
    if (isV4Response(frame)) {
      const id = frame['message-id'];
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      clearTimeout(pending.timer);
      if (frame.status === 'ok') {
        pending.resolve(frame as unknown as Record<string, unknown>);
      } else {
        const err = new Error(frame.error ?? 'v4 request failed') as Error & { code?: number };
        if (frame.code) err.code = Number(frame.code);
        pending.reject(err);
      }
    }
  }

  private handleEvent(v4Event: Record<string, unknown>): void {
    const updateType = String(v4Event['update-type'] ?? '');

    // Maintain the scene-item cache from event side effects before
    // translating. Translation depends on the cache being in sync for
    // SceneItemVisibilityChanged in particular.
    this.maintainCachesFromEvent(updateType, v4Event);

    // Track recording paused state for ToggleRecordPause translation.
    if (updateType === 'RecordingPaused') this.recordPaused = true;
    else if (updateType === 'RecordingResumed' || updateType === 'RecordingStopped')
      this.recordPaused = false;

    const translated = translateEvent(v4Event);
    if (!translated) return;
    this.emit(translated.internal, translated.payload);
  }

  private maintainCachesFromEvent(updateType: string, v4Event: Record<string, unknown>): void {
    switch (updateType) {
      case 'ScenesChanged':
        // Full rebuild — async, fire and forget. Subsequent events will use
        // whatever's in the cache; that's fine because the rebuild's racy
        // window is tiny and SetSceneItemEnabled has a refresh-on-miss path.
        void this.primeSceneItemCache();
        break;
      case 'SceneItemAdded': {
        // P0-2: design called for this; was missing. Without it, a freshly
        // added item is invisible to SetSceneItemEnabled until either a
        // ScenesChanged event arrives (rare) or the refresh-on-miss path
        // triggers a round-trip per call.
        const sceneName = String(v4Event['scene-name'] ?? '');
        if (!sceneName) return;
        void this.refreshSceneItemsFor(sceneName);
        break;
      }
      case 'SceneItemRemoved': {
        // P0-2: drop the removed entry by id. v4's SceneItemRemoved carries
        // `scene-name` and `item-id`. Without this, the cache holds a stale
        // {id → name} that points at a non-existent item; SetSceneItemEnabled
        // would then send a v4 request that always errors with "item not
        // found" even though the cache claims it exists.
        const sceneName = String(v4Event['scene-name'] ?? '');
        const itemId = Number(v4Event['item-id'] ?? -1);
        if (!sceneName || itemId < 0) return;
        this.sceneItems.get(sceneName)?.delete(itemId);
        break;
      }
      case 'SourceRenamed': {
        const oldName = String(v4Event.previousName ?? '');
        const newName = String(v4Event.newName ?? '');
        if (!oldName || !newName) return;
        for (const items of this.sceneItems.values()) {
          for (const [id, name] of items.entries()) {
            if (name === oldName) items.set(id, newName);
          }
        }
        break;
      }
      default:
        break;
    }
  }

  private rawV4Call(
    internalName: string,
    v4Type: string,
    v4Payload: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('not connected'));
    }
    const messageId = randomUUID();
    const frame = { 'request-type': v4Type, 'message-id': messageId, ...v4Payload };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(messageId);
        reject(new Error('v4 request timed out: ' + v4Type));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(messageId, { resolve, reject, timer, internalName });
      try {
        ws.send(JSON.stringify(frame));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(messageId);
        reject(err as Error);
      }
    });
  }

  private async runAuth(password: string | undefined): Promise<void> {
    const resp = await this.rawV4Call('GetAuthRequired', 'GetAuthRequired', {});
    if (!resp.authRequired) return;
    if (!password) {
      throw new AuthFailedError('authentication required but no password provided');
    }
    const challenge = String(resp.challenge ?? '');
    const salt = String(resp.salt ?? '');
    const auth = computeV4Auth(password, salt, challenge);
    try {
      await this.rawV4Call('Authenticate', 'Authenticate', { auth });
    } catch (err) {
      // P1-10: any error response to Authenticate means the credentials
      // were rejected. v4 has no numeric code we can pivot on (only an
      // `error` string field) — pre-fix this used a /auth/i regex against
      // the message, which broke on non-English OBS server locales.
      // Since the request-type is fixed, the failure reason is also
      // fixed: bad credentials. Always surface AuthFailedError so the
      // route handler's `err instanceof AuthFailedError` path triggers.
      throw new AuthFailedError((err as Error).message ?? 'authentication failed');
    }
  }

  private async primeSceneItemCache(): Promise<void> {
    // P0-1: bail when disconnect() ran between primeVcamPoll's await and
    // here. Without this, the cache is repopulated against a dead socket
    // and the subsequent setInterval (for vcam) leaks past disconnect.
    if (this.closing) return;
    try {
      const sceneList = await this.rawV4Call('GetSceneList', 'GetSceneList', {});
      if (this.closing) return;
      type V4Scene = { name: string };
      const scenes = (sceneList.scenes as V4Scene[] | undefined) ?? [];
      this.sceneItems.clear();
      await Promise.allSettled(
        scenes.map(async (s) => {
          if (this.closing) return;
          await this.refreshSceneItemsFor(s.name);
        })
      );
    } catch {
      // best-effort prime; cache miss path handles individual scenes
    }
  }

  private async refreshSceneItemsFor(sceneName: string): Promise<void> {
    try {
      const r = await this.rawV4Call('GetSceneItemList', 'GetSceneItemList', {
        'scene-name': sceneName,
      });
      type V4Item = { itemId?: number; id?: number; sourceName?: string; name?: string };
      const items =
        (r['scene-items'] as V4Item[] | undefined) ??
        (r.items as V4Item[] | undefined) ??
        [];
      const map = new Map<number, string>();
      for (const i of items) {
        const id = Number(i.itemId ?? i.id ?? 0);
        const name = String(i.sourceName ?? i.name ?? '');
        if (id && name) map.set(id, name);
      }
      this.sceneItems.set(sceneName, map);
    } catch {
      // ignore; cache stays empty for this scene
    }
  }

  /**
   * Gap-3 fix: v4 has no VirtualcamStateChanged event. Poll every 5s and
   * emit a synthesized event only when the value flips.
   *
   * P0-1: the GetVirtualCamStatus await opens a race window during which
   * disconnect() might run. We must re-check this.closing both before AND
   * after that await — otherwise setInterval registers a timer that
   * outlives the connection's socket, churning RPC rejections every 5s.
   */
  private async primeVcamPoll(): Promise<void> {
    if (this.closing) return;
    try {
      const r = await this.rawV4Call('GetVirtualCamStatus', 'GetVirtualCamStatus', {});
      this.vcamActive = !!r.isVirtualCam || !!r['virtualcam-active'];
    } catch {
      this.vcamActive = false;
    }
    if (this.closing) return;
    this.vcamPollTimer = setInterval(() => {
      void this.pollVcamOnce();
    }, VCAM_POLL_INTERVAL_MS);
    if (typeof this.vcamPollTimer.unref === 'function') this.vcamPollTimer.unref();
  }

  private async pollVcamOnce(): Promise<void> {
    try {
      const r = await this.rawV4Call('GetVirtualCamStatus', 'GetVirtualCamStatus', {});
      const active = !!r.isVirtualCam || !!r['virtualcam-active'];
      if (active !== this.vcamActive) {
        this.vcamActive = active;
        this.emit('VirtualcamStateChanged', { outputActive: active });
      }
    } catch {
      // polling tolerates transient errors
    }
  }

  /**
   * P2-18: test hook. Production code calls pollVcamOnce on the 5s interval;
   * tests don't want to wait 5 seconds, so they call this wrapper to force
   * a one-shot poll. Public-but-prefixed name signals "internal API,
   * subject to change". Pre-2026-05-13 tests cast to `any` to reach the
   * private method — that locked them to the method name and made
   * renames invisible refactors.
   */
  // eslint-disable-next-line @typescript-eslint/naming-convention
  _testForcePollVcam(): Promise<void> {
    return this.pollVcamOnce();
  }
}
