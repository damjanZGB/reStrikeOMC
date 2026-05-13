import { WebSocketServer, type WebSocket } from 'ws';
import { createHash, randomBytes } from 'node:crypto';
import { encode as msgpackEncode, decode as msgpackDecode } from '@msgpack/msgpack';

export interface MockOpts {
  password: string | null;
}

export interface ReceivedRequest {
  requestType: string;
  requestData: Record<string, unknown>;
}

export interface OutputState {
  streaming: boolean;
  recording: boolean;
  recordingPaused: boolean;
  replayBuffer: boolean;
  virtualCam: boolean;
}

export interface InputAudioState {
  muted: boolean;
  volumeMul: number;
  volumeDb: number;
}

export interface MockHandle {
  port: number;
  close: () => Promise<void>;
  changeProgramScene: (name: string) => void;
  setSceneList: (scenes: string[]) => void;
  setInputList: (inputs: Array<{ name: string; kind: string }>) => void;
  setOutputs: (patch: Partial<OutputState>) => void;
  /** Seed an input's mute state. Used by tests to put OBS into "already muted"
   *  before the dashboard connects. Does NOT emit an event. */
  setInputMute: (name: string, muted: boolean) => void;
  /** Seed an input's volume. mul is linear (0..1+), db is the same value
   *  expressed in decibels. Both must be supplied — OBS reports both. */
  setInputVolume: (name: string, vol: { mul: number; db: number }) => void;
  /** Emit an InputVolumeMeters event over the wire to all connected clients.
   *  Each entry is [average, current, peak] per channel — the tuple OBS uses. */
  emitMeters: (perInput: Record<string, number[][]>) => void;
  receivedRequests: ReceivedRequest[];
}

interface ClientState {
  identified: boolean;
  encoding: 'json' | 'msgpack';
}

const SUPPORTED_PROTOCOLS = ['obswebsocket.msgpack', 'obswebsocket.json'];

function makeAuth(password: string, salt: string, challenge: string): string {
  const secret = createHash('sha256').update(password + salt).digest('base64');
  return createHash('sha256').update(secret + challenge).digest('base64');
}

function encodeFrame(encoding: 'json' | 'msgpack', op: number, d: unknown): string | Buffer {
  const payload = { op, d };
  if (encoding === 'json') return JSON.stringify(payload);
  return Buffer.from(msgpackEncode(payload));
}

function decodeFrame(encoding: 'json' | 'msgpack', raw: Buffer | ArrayBuffer | string): unknown {
  if (encoding === 'json') {
    return JSON.parse(typeof raw === 'string' ? raw : Buffer.from(raw as Buffer).toString());
  }
  return msgpackDecode(raw as Uint8Array);
}

export async function startMockObs(opts: MockOpts): Promise<MockHandle> {
  const wss = new WebSocketServer({
    port: 0,
    host: '127.0.0.1',
    handleProtocols: (protocols) => {
      for (const p of SUPPORTED_PROTOCOLS) {
        if (protocols.has(p)) return p;
      }
      return false;
    },
  });
  await new Promise<void>((resolve) => wss.once('listening', () => resolve()));
  const port = (wss.address() as { port: number }).port;
  const clients = new Set<WebSocket>();
  let scenes: string[] = ['Scene 1', 'Scene 2'];
  let programScene = 'Scene 1';
  let inputs: Array<{ name: string; kind: string }> = [
    { name: 'Mic', kind: 'wasapi_input_capture' },
  ];
  const audio = new Map<string, InputAudioState>();
  function audioFor(name: string): InputAudioState {
    let s = audio.get(name);
    if (!s) {
      s = { muted: false, volumeMul: 1, volumeDb: 0 };
      audio.set(name, s);
    }
    return s;
  }
  let outputs: OutputState = {
    streaming: false,
    recording: false,
    recordingPaused: false,
    replayBuffer: false,
    virtualCam: false,
  };
  const receivedRequests: ReceivedRequest[] = [];

  function send(ws: WebSocket, encoding: 'json' | 'msgpack', op: number, d: unknown): void {
    ws.send(encodeFrame(encoding, op, d));
  }

  function broadcast(op: number, d: unknown): void {
    for (const c of clients) {
      const enc = (c as WebSocket & { __mockEnc?: 'json' | 'msgpack' }).__mockEnc ?? 'json';
      send(c, enc, op, d);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function handleMessage(ws: WebSocket, state: ClientState, msg: any): void {
    if (msg.op === 1) {
      send(ws, state.encoding, 2, { negotiatedRpcVersion: 1 });
      state.identified = true;
      return;
    }
    if (!state.identified) return;
    if (msg.op === 6) {
      const { requestType, requestId, requestData } = msg.d;
      receivedRequests.push({ requestType, requestData: requestData ?? {} });
      const reply = (
        status: { result: boolean; code?: number; comment?: string },
        responseData?: unknown
      ): void =>
        send(ws, state.encoding, 7, {
          requestType,
          requestId,
          requestStatus: status,
          responseData,
        });
      switch (requestType) {
        case 'GetVersion':
          return reply(
            { result: true, code: 100 },
            { obsVersion: '30.0.0', obsWebSocketVersion: '5.0.0' }
          );
        case 'GetSceneList':
          return reply(
            { result: true, code: 100 },
            {
              currentProgramSceneName: programScene,
              currentPreviewSceneName: null,
              scenes: scenes.map((name, i) => ({ sceneName: name, sceneIndex: i })),
            }
          );
        case 'GetInputList':
          return reply(
            { result: true, code: 100 },
            {
              inputs: inputs.map((i) => ({
                inputName: i.name,
                inputKind: i.kind,
                unversionedInputKind: i.kind,
              })),
            }
          );
        case 'SetCurrentProgramScene': {
          const name = requestData?.sceneName as string;
          if (!scenes.includes(name)) {
            return reply({ result: false, code: 600, comment: 'no such scene' });
          }
          programScene = name;
          reply({ result: true, code: 100 });
          for (const c of clients) {
            const enc = (c as WebSocket & { __mockEnc?: 'json' | 'msgpack' }).__mockEnc ?? 'json';
            send(c, enc, 5, {
              eventType: 'CurrentProgramSceneChanged',
              eventIntent: 1,
              eventData: { sceneName: name },
            });
          }
          return;
        }
        case 'SetInputMute': {
          const name = requestData?.inputName as string;
          if (!inputs.find((i) => i.name === name)) {
            return reply({ result: false, code: 601, comment: 'no such input' });
          }
          if (typeof requestData?.inputMuted !== 'boolean') {
            return reply({ result: false, code: 402, comment: 'inputMuted must be boolean' });
          }
          audioFor(name).muted = requestData.inputMuted as boolean;
          reply({ result: true, code: 100 });
          broadcast(5, {
            eventType: 'InputMuteStateChanged',
            eventIntent: 1,
            eventData: { inputName: name, inputMuted: audioFor(name).muted },
          });
          return;
        }
        case 'SetInputVolume': {
          const name = requestData?.inputName as string;
          if (!inputs.find((i) => i.name === name)) {
            return reply({ result: false, code: 601, comment: 'no such input' });
          }
          if (
            requestData?.inputVolumeMul === undefined &&
            requestData?.inputVolumeDb === undefined
          ) {
            return reply({
              result: false,
              code: 402,
              comment: 'inputVolumeMul or inputVolumeDb required',
            });
          }
          const a = audioFor(name);
          if (typeof requestData?.inputVolumeMul === 'number') {
            a.volumeMul = requestData.inputVolumeMul as number;
            a.volumeDb = a.volumeMul > 0 ? 20 * Math.log10(a.volumeMul) : -100;
          } else {
            a.volumeDb = requestData?.inputVolumeDb as number;
            a.volumeMul = Math.pow(10, a.volumeDb / 20);
          }
          reply({ result: true, code: 100 });
          broadcast(5, {
            eventType: 'InputVolumeChanged',
            eventIntent: 1,
            eventData: { inputName: name, inputVolumeMul: a.volumeMul, inputVolumeDb: a.volumeDb },
          });
          return;
        }
        case 'GetInputMute': {
          const name = requestData?.inputName as string;
          if (!inputs.find((i) => i.name === name)) {
            return reply({ result: false, code: 601, comment: 'no such input' });
          }
          return reply({ result: true, code: 100 }, { inputMuted: audioFor(name).muted });
        }
        case 'GetInputVolume': {
          const name = requestData?.inputName as string;
          if (!inputs.find((i) => i.name === name)) {
            return reply({ result: false, code: 601, comment: 'no such input' });
          }
          const a = audioFor(name);
          return reply(
            { result: true, code: 100 },
            { inputVolumeMul: a.volumeMul, inputVolumeDb: a.volumeDb }
          );
        }
        case 'GetStreamStatus':
          return reply(
            { result: true, code: 100 },
            {
              outputActive: outputs.streaming,
              outputReconnecting: false,
              outputTimecode: '00:00:00.000',
              outputDuration: 0,
              outputCongestion: 0,
              outputBytes: 0,
              outputSkippedFrames: 0,
              outputTotalFrames: 0,
            }
          );
        case 'GetRecordStatus':
          return reply(
            { result: true, code: 100 },
            {
              outputActive: outputs.recording,
              outputPaused: outputs.recordingPaused,
              outputTimecode: '00:00:00.000',
              outputDuration: 0,
              outputBytes: 0,
            }
          );
        case 'GetReplayBufferStatus':
          return reply({ result: true, code: 100 }, { outputActive: outputs.replayBuffer });
        case 'GetVirtualCamStatus':
          return reply({ result: true, code: 100 }, { outputActive: outputs.virtualCam });
        default:
          return reply({ result: false, code: 204, comment: 'not implemented in mock' });
      }
    }
  }

  wss.on('connection', (ws) => {
    clients.add(ws);
    const encoding: 'json' | 'msgpack' = ws.protocol === 'obswebsocket.msgpack' ? 'msgpack' : 'json';
    (ws as WebSocket & { __mockEnc?: 'json' | 'msgpack' }).__mockEnc = encoding;
    const state: ClientState = { identified: false, encoding };

    if (opts.password === null) {
      send(ws, encoding, 0, { obsWebSocketVersion: '5.0.0', rpcVersion: 1 });
      ws.on('message', (raw) => {
        try {
          handleMessage(ws, state, decodeFrame(encoding, raw as Buffer));
        } catch {
          // ignore malformed
        }
      });
      ws.on('close', () => clients.delete(ws));
      return;
    }

    const challenge = randomBytes(16).toString('base64');
    const salt = randomBytes(16).toString('base64');
    const expected = makeAuth(opts.password, salt, challenge);
    send(ws, encoding, 0, {
      obsWebSocketVersion: '5.0.0',
      rpcVersion: 1,
      authentication: { challenge, salt },
    });
    const authHandler = (raw: Buffer): void => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const msg = decodeFrame(encoding, raw) as any;
        if (msg.op === 1) {
          if (msg.d?.authentication !== expected) {
            ws.close(4009, 'auth failed');
            return;
          }
          ws.off('message', authHandler);
          ws.on('message', (r2) => {
            try {
              handleMessage(ws, state, decodeFrame(encoding, r2 as Buffer));
            } catch {
              // ignore
            }
          });
          handleMessage(ws, state, msg);
        }
      } catch {
        ws.close();
      }
    };
    ws.on('message', authHandler);
    ws.on('close', () => clients.delete(ws));
  });

  return {
    port,
    close: async () => {
      // terminate() force-kills sockets. close() leaves discovery-probe
      // half-open upgrades lingering until OS-level TIME_WAIT, blocking
      // wss.close() indefinitely.
      for (const c of wss.clients) c.terminate();
      await new Promise<void>((r) => setImmediate(r));
      await new Promise<void>((res) => wss.close(() => res()));
    },
    changeProgramScene(name) {
      programScene = name;
      for (const c of clients) {
        const enc = (c as WebSocket & { __mockEnc?: 'json' | 'msgpack' }).__mockEnc ?? 'json';
        send(c, enc, 5, {
          eventType: 'CurrentProgramSceneChanged',
          eventIntent: 1,
          eventData: { sceneName: name },
        });
      }
    },
    setSceneList(s) {
      scenes = s;
    },
    setInputList(i) {
      inputs = i;
    },
    setOutputs(patch) {
      outputs = { ...outputs, ...patch };
    },
    setInputMute(name, muted) {
      audioFor(name).muted = muted;
    },
    setInputVolume(name, vol) {
      const a = audioFor(name);
      a.volumeMul = vol.mul;
      a.volumeDb = vol.db;
    },
    emitMeters(perInput) {
      broadcast(5, {
        eventType: 'InputVolumeMeters',
        eventIntent: 1 << 16,
        eventData: {
          inputs: Object.entries(perInput).map(([inputName, channels]) => ({
            inputName,
            inputLevelsMul: channels,
          })),
        },
      });
    },
    receivedRequests,
  };
}
