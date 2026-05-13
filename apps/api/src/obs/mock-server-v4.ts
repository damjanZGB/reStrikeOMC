import { WebSocketServer, type WebSocket } from 'ws';
import { createHash, randomBytes } from 'node:crypto';
import { isAudioKind } from './clients/v4-translate.js';

/**
 * Minimal obs-websocket v4 mock used by tests. Implements just enough of the
 * v4 wire protocol — auth handshake, request/response, event emission — to
 * exercise the ObsV4Client adapter end-to-end. Not a drop-in OBS substitute.
 */

export interface MockV4Opts {
  password: string | null;
}

export interface V4Source {
  name: string;
  typeId: string;
}

export interface V4SceneItem {
  itemId: number;
  sourceName: string;
}

export interface MockV4Handle {
  port: number;
  close: () => Promise<void>;
  setScenes: (scenes: Array<{ name: string; items?: V4SceneItem[] }>) => void;
  setCurrentScene: (name: string) => void;
  setSources: (sources: V4Source[]) => void;
  setMute: (sourceName: string, muted: boolean) => void;
  setOutputs: (patch: {
    streaming?: boolean;
    recording?: boolean;
    recordingPaused?: boolean;
    replayBuffer?: boolean;
    virtualCam?: boolean;
  }) => void;
  emitEvent: (updateType: string, payload?: Record<string, unknown>) => void;
  /** Forces a synthetic VirtualcamStateChanged value flip for poll testing. */
  flipVcam: () => void;
  receivedRequests: Array<{ requestType: string; payload: Record<string, unknown> }>;
}

function makeAuth(password: string, salt: string, challenge: string): string {
  const secret = createHash('sha256').update(password + salt).digest('base64');
  return createHash('sha256').update(secret + challenge).digest('base64');
}

export async function startMockObsV4(opts: MockV4Opts): Promise<MockV4Handle> {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>((resolve) => wss.once('listening', () => resolve()));
  const port = (wss.address() as { port: number }).port;

  const clients = new Set<WebSocket>();
  let scenes: Array<{ name: string; items: V4SceneItem[] }> = [
    { name: 'Scene 1', items: [] },
    { name: 'Scene 2', items: [] },
  ];
  let currentScene = 'Scene 1';
  let sources: V4Source[] = [{ name: 'Mic', typeId: 'wasapi_input_capture' }];
  const muted = new Map<string, boolean>();
  let outputs = {
    streaming: false,
    recording: false,
    recordingPaused: false,
    replayBuffer: false,
    virtualCam: false,
  };
  const receivedRequests: Array<{ requestType: string; payload: Record<string, unknown> }> = [];

  function sendFrame(ws: WebSocket, frame: Record<string, unknown>): void {
    ws.send(JSON.stringify(frame));
  }

  function broadcast(updateType: string, payload: Record<string, unknown> = {}): void {
    const frame = { 'update-type': updateType, ...payload };
    for (const c of clients) sendFrame(c, frame);
  }

  function reply(
    ws: WebSocket,
    messageId: string,
    ok: boolean,
    payload: Record<string, unknown> = {},
    error?: string
  ): void {
    sendFrame(ws, {
      'message-id': messageId,
      status: ok ? 'ok' : 'error',
      ...(error ? { error } : {}),
      ...payload,
    });
  }

  function handleRequest(
    ws: WebSocket,
    msg: Record<string, unknown>,
    authState: { authed: boolean }
  ): void {
    const requestType = String(msg['request-type'] ?? '');
    const messageId = String(msg['message-id'] ?? '');
    receivedRequests.push({
      requestType,
      payload: { ...msg, 'request-type': undefined, 'message-id': undefined } as Record<
        string,
        unknown
      >,
    });

    if (!authState.authed && requestType !== 'GetAuthRequired' && requestType !== 'Authenticate') {
      reply(ws, messageId, false, {}, 'Not Authenticated');
      return;
    }

    switch (requestType) {
      case 'GetAuthRequired': {
        if (opts.password === null) {
          authState.authed = true;
          return reply(ws, messageId, true, { authRequired: false });
        }
        const challenge = randomBytes(16).toString('base64');
        const salt = randomBytes(16).toString('base64');
        const expected = makeAuth(opts.password, salt, challenge);
        // Stash expected auth value on the connection for the Authenticate
        // step.
        (ws as WebSocket & { __expected?: string }).__expected = expected;
        return reply(ws, messageId, true, { authRequired: true, challenge, salt });
      }
      case 'Authenticate': {
        const expected = (ws as WebSocket & { __expected?: string }).__expected;
        const provided = String(msg.auth ?? '');
        if (!expected || expected !== provided) {
          return reply(ws, messageId, false, {}, 'Authentication Failed.');
        }
        authState.authed = true;
        return reply(ws, messageId, true);
      }
      case 'GetSceneList':
        return reply(ws, messageId, true, {
          'current-scene': currentScene,
          scenes: scenes.map((s) => ({ name: s.name, sources: s.items.map((i) => ({ name: i.sourceName })) })),
        });
      case 'GetSceneItemList': {
        const sceneName = String(msg['scene-name'] ?? '');
        const scene = scenes.find((s) => s.name === sceneName);
        if (!scene) return reply(ws, messageId, false, {}, 'specified scene doesn\'t exist');
        return reply(ws, messageId, true, {
          'scene-items': scene.items.map((i) => ({ itemId: i.itemId, sourceName: i.sourceName })),
        });
      }
      case 'GetSourcesList':
        return reply(ws, messageId, true, {
          sources: sources.map((s) => ({ name: s.name, typeId: s.typeId, type: 'input' })),
        });
      case 'GetStreamingStatus':
        return reply(ws, messageId, true, {
          streaming: outputs.streaming,
          recording: outputs.recording,
          'recording-paused': outputs.recordingPaused,
          'total-stream-time': 0,
        });
      case 'GetRecordingStatus':
        return reply(ws, messageId, true, {
          'is-recording': outputs.recording,
          'is-recording-paused': outputs.recordingPaused,
          'rec-timecode': '00:00:00.000',
        });
      case 'GetReplayBufferStatus':
        return reply(ws, messageId, true, { 'is-replay-buffer-active': outputs.replayBuffer });
      case 'GetVirtualCamStatus':
        return reply(ws, messageId, true, { isVirtualCam: outputs.virtualCam });
      case 'GetMute': {
        const source = String(msg.source ?? '');
        if (!sources.find((s) => s.name === source)) {
          return reply(ws, messageId, false, {}, 'source not found');
        }
        return reply(ws, messageId, true, { name: source, muted: !!muted.get(source) });
      }
      case 'GetVolume': {
        const source = String(msg.source ?? '');
        if (!sources.find((s) => s.name === source)) {
          return reply(ws, messageId, false, {}, 'source not found');
        }
        return reply(ws, messageId, true, { name: source, volume: 1, muted: !!muted.get(source) });
      }
      case 'GetPreviewScene':
        return reply(ws, messageId, false, {}, 'studio mode not active');
      case 'SetCurrentScene': {
        const name = String(msg['scene-name'] ?? '');
        if (!scenes.find((s) => s.name === name)) {
          return reply(ws, messageId, false, {}, 'no such scene');
        }
        currentScene = name;
        reply(ws, messageId, true);
        broadcast('SwitchScenes', { 'scene-name': name });
        return;
      }
      case 'SetMute': {
        const source = String(msg.source ?? '');
        if (!sources.find((s) => s.name === source)) {
          return reply(ws, messageId, false, {}, 'source not found');
        }
        const m = !!msg.mute;
        muted.set(source, m);
        reply(ws, messageId, true);
        broadcast('SourceMuteStateChanged', { sourceName: source, muted: m });
        return;
      }
      case 'SetVolume':
        return reply(ws, messageId, true);
      case 'SetSceneItemProperties': {
        const sceneName = String(msg['scene-name'] ?? '');
        const itemInfo = msg.item as { name?: string } | undefined;
        const itemName = String(itemInfo?.name ?? '');
        const scene = scenes.find((s) => s.name === sceneName);
        if (!scene) return reply(ws, messageId, false, {}, 'scene not found');
        const item = scene.items.find((i) => i.sourceName === itemName);
        if (!item) return reply(ws, messageId, false, {}, 'item not found');
        reply(ws, messageId, true);
        broadcast('SceneItemVisibilityChanged', {
          'scene-name': sceneName,
          'item-id': item.itemId,
          'item-name': itemName,
          'item-visible': !!msg.visible,
        });
        return;
      }
      case 'StartStopStreaming':
        outputs = { ...outputs, streaming: !outputs.streaming };
        reply(ws, messageId, true);
        broadcast(outputs.streaming ? 'StreamStarting' : 'StreamStopped');
        return;
      case 'StartStopRecording':
        outputs = { ...outputs, recording: !outputs.recording };
        reply(ws, messageId, true);
        broadcast(outputs.recording ? 'RecordingStarting' : 'RecordingStopped');
        return;
      case 'StartStopReplayBuffer':
        outputs = { ...outputs, replayBuffer: !outputs.replayBuffer };
        reply(ws, messageId, true);
        broadcast(outputs.replayBuffer ? 'ReplayStarting' : 'ReplayStopped');
        return;
      case 'SaveReplayBuffer':
        return reply(ws, messageId, true);
      case 'StartStopVirtualCam':
        outputs = { ...outputs, virtualCam: !outputs.virtualCam };
        return reply(ws, messageId, true);
      default:
        return reply(ws, messageId, false, {}, 'not implemented in mock');
    }
  }

  wss.on('connection', (ws) => {
    clients.add(ws);
    const authState = { authed: false };
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString('utf-8')) as Record<string, unknown>;
        handleRequest(ws, msg, authState);
      } catch {
        // ignore malformed frames
      }
    });
    ws.on('close', () => clients.delete(ws));
  });

  // Filter unused param warning.
  void isAudioKind;

  return {
    port,
    close: async () => {
      for (const c of clients) c.close();
      await new Promise<void>((res) => wss.close(() => res()));
    },
    setScenes(s) {
      scenes = s.map((entry) => ({ name: entry.name, items: entry.items ?? [] }));
    },
    setCurrentScene(name) {
      currentScene = name;
    },
    setSources(s) {
      sources = s;
    },
    setMute(name, m) {
      muted.set(name, m);
    },
    setOutputs(patch) {
      outputs = { ...outputs, ...patch };
    },
    emitEvent(updateType, payload = {}) {
      broadcast(updateType, payload);
    },
    flipVcam() {
      outputs = { ...outputs, virtualCam: !outputs.virtualCam };
    },
    receivedRequests,
  };
}
