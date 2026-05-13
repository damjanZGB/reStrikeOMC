/**
 * Pure translation functions between the internal v5-vocab and the v4 wire
 * vocab. Stateless: the v4 client owns its scene-item cache and feeds the
 * relevant lookup into translateRequest when needed.
 *
 * Throws Error('unsupported_v4_command: <name>') on unknown commands —
 * defensive only; the API schema gates inputs upstream.
 */

export interface SceneItemLookup {
  /** Returns the v4 item-name for a {sceneName, sceneItemId} pair. */
  itemNameForId(sceneName: string, sceneItemId: number): string | null;
}

export interface TranslatedRequest {
  v4Type: string;
  v4Payload: Record<string, unknown>;
}

/**
 * Internal client may also need to track ToggleRecordPause state to pick the
 * right v4 verb (PauseRecording vs ResumeRecording). The caller passes the
 * latest known paused state; translateRequest just picks the verb.
 */
export interface TranslateRequestCtx {
  sceneItems?: SceneItemLookup;
  recordPaused?: boolean;
}

const dbToMul = (db: number): number => Math.pow(10, db / 20);
const mulToDb = (mul: number): number => (mul > 0 ? 20 * Math.log10(mul) : -100);

/**
 * Convert an unknown value to a finite number. Falls back when the value is
 * non-numeric, NaN, or Infinity — protects against a misbehaving peer sending
 * e.g. `"volume": "loud"` from being interpreted as Number("loud") === NaN,
 * which would then propagate through mulToDb and produce NaN dB readouts.
 */
function safeNumber(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Internal commands whose v4 wire response is a bare `{status: 'ok', ...}`
 * with no payload worth reshaping. The v4 client's `call()` validates against
 * this set when `translateResponse` returns null — that combination is the
 * sentinel for "expected null, treat as void". Anything else throws so a
 * future internal command added to translateRequest without a translateResponse
 * case fails loudly instead of leaking the raw v4 frame.
 */
export const WRITE_COMMANDS = new Set<string>([
  'SetCurrentProgramScene',
  'SetCurrentPreviewScene',
  'SetStudioModeEnabled',
  'TransitionToProgram',
  'SetCurrentSceneTransition',
  'SetCurrentSceneTransitionDuration',
  'SetSceneItemEnabled',
  'SetInputMute',
  'SetInputVolume',
  'SetInputAudioSyncOffset',
  'ToggleStream',
  'ToggleRecord',
  'ToggleRecordPause',
  'ToggleReplayBuffer',
  'SaveReplayBuffer',
  'ToggleVirtualCam',
  'TriggerHotkeyByName',
  'SetCurrentSceneCollection',
  'SetCurrentProfile',
]);

export function translateRequest(
  internal: string,
  payload: Record<string, unknown>,
  ctx: TranslateRequestCtx = {}
): TranslatedRequest {
  switch (internal) {
    case 'SetCurrentProgramScene':
      return { v4Type: 'SetCurrentScene', v4Payload: { 'scene-name': payload.sceneName } };

    case 'SetCurrentPreviewScene':
      return { v4Type: 'SetPreviewScene', v4Payload: { 'scene-name': payload.sceneName } };

    case 'SetStudioModeEnabled':
      return {
        v4Type: payload.enabled ? 'EnableStudioMode' : 'DisableStudioMode',
        v4Payload: {},
      };

    case 'TransitionToProgram': {
      const out: Record<string, unknown> = {};
      if (payload.transitionName !== undefined || payload.transitionDurationMs !== undefined) {
        const wt: Record<string, unknown> = {};
        if (payload.transitionName !== undefined) wt.name = payload.transitionName;
        if (payload.transitionDurationMs !== undefined) wt.duration = payload.transitionDurationMs;
        out['with-transition'] = wt;
      }
      return { v4Type: 'TransitionToProgram', v4Payload: out };
    }

    case 'SetCurrentSceneTransition':
      return {
        v4Type: 'SetCurrentTransition',
        v4Payload: { 'transition-name': payload.transitionName },
      };

    case 'SetCurrentSceneTransitionDuration':
      return {
        v4Type: 'SetTransitionDuration',
        v4Payload: { duration: payload.transitionDurationMs },
      };

    case 'SetSceneItemEnabled': {
      const sceneName = String(payload.sceneName ?? '');
      const sceneItemId = Number(payload.sceneItemId ?? -1);
      const itemName = ctx.sceneItems?.itemNameForId(sceneName, sceneItemId);
      if (!itemName) {
        throw new Error(
          'v4 scene-item lookup miss: scene=' + sceneName + ' id=' + sceneItemId
        );
      }
      return {
        v4Type: 'SetSceneItemProperties',
        v4Payload: {
          'scene-name': sceneName,
          item: { name: itemName },
          visible: !!payload.sceneItemEnabled,
        },
      };
    }

    case 'SetInputMute':
      return {
        v4Type: 'SetMute',
        v4Payload: { source: payload.inputName, mute: !!payload.muted },
      };

    case 'SetInputVolume': {
      // v4 SetVolume accepts {source, volume} where volume is a linear
      // multiplier. If the caller only sent dB, convert; otherwise pass mul.
      const mul =
        payload.volumeMul !== undefined
          ? Number(payload.volumeMul)
          : dbToMul(Number(payload.volumeDb ?? 0));
      return { v4Type: 'SetVolume', v4Payload: { source: payload.inputName, volume: mul } };
    }

    case 'SetInputAudioSyncOffset':
      return {
        v4Type: 'SetSyncOffset',
        v4Payload: {
          source: payload.inputName,
          offset: Number(payload.syncOffsetMs ?? 0) * 1_000_000, // ms to ns
        },
      };

    case 'ToggleStream':
      return { v4Type: 'StartStopStreaming', v4Payload: {} };
    case 'ToggleRecord':
      return { v4Type: 'StartStopRecording', v4Payload: {} };
    case 'ToggleRecordPause':
      return {
        v4Type: ctx.recordPaused ? 'ResumeRecording' : 'PauseRecording',
        v4Payload: {},
      };
    case 'ToggleReplayBuffer':
      return { v4Type: 'StartStopReplayBuffer', v4Payload: {} };
    case 'SaveReplayBuffer':
      return { v4Type: 'SaveReplayBuffer', v4Payload: {} };
    case 'ToggleVirtualCam':
      return { v4Type: 'StartStopVirtualCam', v4Payload: {} };

    case 'TriggerHotkeyByName':
      return { v4Type: 'TriggerHotkeyByName', v4Payload: { hotkeyName: payload.hotkeyName } };

    case 'SetCurrentSceneCollection':
      return {
        v4Type: 'SetCurrentSceneCollection',
        v4Payload: { 'sc-name': payload.sceneCollectionName },
      };

    case 'SetCurrentProfile':
      return {
        v4Type: 'SetCurrentProfile',
        v4Payload: { 'profile-name': payload.profileName },
      };

    case 'GetSceneList':
      return { v4Type: 'GetSceneList', v4Payload: {} };
    case 'GetInputList':
      return { v4Type: 'GetSourcesList', v4Payload: {} };
    case 'GetStreamStatus':
      return { v4Type: 'GetStreamingStatus', v4Payload: {} };
    case 'GetRecordStatus':
      return { v4Type: 'GetRecordingStatus', v4Payload: {} };
    case 'GetReplayBufferStatus':
      return { v4Type: 'GetReplayBufferStatus', v4Payload: {} };
    case 'GetVirtualCamStatus':
      return { v4Type: 'GetVirtualCamStatus', v4Payload: {} };
    case 'GetInputMute':
      return { v4Type: 'GetMute', v4Payload: { source: payload.inputName } };
    case 'GetInputVolume':
      return { v4Type: 'GetVolume', v4Payload: { source: payload.inputName } };
    case 'GetPreviewScene':
      return { v4Type: 'GetPreviewScene', v4Payload: {} };
    case 'GetSceneItemList':
      return { v4Type: 'GetSceneItemList', v4Payload: { 'scene-name': payload.sceneName } };

    default:
      throw new Error('unsupported_v4_command: ' + internal);
  }
}

/**
 * Reshape a v4 response into the v5-shaped payload the rest of the codebase
 * expects. Returns null for response types we don't reshape (passthrough).
 */
export function translateResponse(
  internal: string,
  v4: Record<string, unknown>
): Record<string, unknown> | null {
  switch (internal) {
    case 'GetSceneList': {
      type V4Scene = { name: string; sources?: unknown[] };
      const scenes = (v4.scenes as V4Scene[] | undefined) ?? [];
      return {
        currentProgramSceneName: (v4['current-scene'] as string | undefined) ?? null,
        currentPreviewSceneName: null,
        scenes: scenes.map((s, i) => ({ sceneName: s.name, sceneIndex: i })),
      };
    }
    case 'GetInputList': {
      type V4Source = { name: string; typeId: string; type: string };
      const sources = (v4.sources as V4Source[] | undefined) ?? [];
      const audio = sources.filter((s) => isAudioKind(s.typeId));
      return {
        inputs: audio.map((s) => ({ inputName: s.name, inputKind: s.typeId })),
      };
    }
    case 'GetStreamStatus':
      return {
        outputActive: !!v4.streaming,
        outputDuration:
          typeof v4['total-stream-time'] === 'number'
            ? (v4['total-stream-time'] as number) * 1000
            : 0,
      };
    case 'GetRecordStatus':
      return {
        outputActive: !!v4['is-recording'] || !!v4.recording,
        outputPaused: !!v4['is-recording-paused'],
        outputDuration:
          typeof v4['rec-timecode'] === 'string' ? parseTimecodeMs(v4['rec-timecode'] as string) : 0,
      };
    case 'GetReplayBufferStatus':
      return { outputActive: !!v4['is-replay-buffer-active'] || !!v4.isReplayBufferActive };
    case 'GetVirtualCamStatus':
      return { outputActive: !!v4.isVirtualCam || !!v4['virtualcam-active'] };
    case 'GetInputMute':
      return { inputMuted: !!v4.muted };
    case 'GetInputVolume': {
      const mul = safeNumber(v4.volume, 0);
      return { inputVolumeMul: mul, inputVolumeDb: mulToDb(mul) };
    }
    case 'GetPreviewScene':
      return { currentPreviewSceneName: (v4.name as string | undefined) ?? null };
    case 'GetSceneItemList': {
      type V4Item = { itemId?: number; id?: number; sourceName?: string; name?: string };
      const items =
        (v4['scene-items'] as V4Item[] | undefined) ??
        (v4.items as V4Item[] | undefined) ??
        [];
      return {
        sceneItems: items.map((i) => ({
          sceneItemId: Number(i.itemId ?? i.id ?? 0),
          sourceName: String(i.sourceName ?? i.name ?? ''),
        })),
      };
    }
    default:
      return null;
  }
}

export interface TranslatedEvent {
  internal: string;
  payload: Record<string, unknown>;
}

/**
 * Translate a v4 event frame into a (name, payload) pair using internal
 * vocabulary. Returns null for events we discard (Heartbeat, Exiting,
 * SourceCreated for non-audio kinds, etc).
 */
export function translateEvent(v4Event: Record<string, unknown>): TranslatedEvent | null {
  const updateType = String(v4Event['update-type'] ?? '');
  switch (updateType) {
    case 'SwitchScenes':
      return {
        internal: 'CurrentProgramSceneChanged',
        payload: { sceneName: String(v4Event['scene-name'] ?? '') },
      };
    case 'PreviewSceneChanged':
      return {
        internal: 'CurrentPreviewSceneChanged',
        payload: { sceneName: String(v4Event['scene-name'] ?? '') },
      };
    case 'StudioModeSwitched':
      return {
        internal: 'StudioModeStateChanged',
        payload: { studioModeEnabled: !!v4Event['new-state'] },
      };
    case 'ScenesChanged':
      return { internal: 'SceneListChanged', payload: {} };
    case 'SceneItemVisibilityChanged':
      return {
        internal: 'SceneItemEnableStateChanged',
        payload: {
          sceneName: String(v4Event['scene-name'] ?? ''),
          sceneItemId: Number(v4Event['item-id'] ?? 0),
          sceneItemEnabled: !!v4Event['item-visible'],
        },
      };
    case 'SourceMuteStateChanged':
      return {
        internal: 'InputMuteStateChanged',
        payload: {
          inputName: String(v4Event.sourceName ?? ''),
          inputMuted: !!v4Event.muted,
        },
      };
    case 'SourceVolumeChanged': {
      const mul = safeNumber(v4Event.volume, 0);
      return {
        internal: 'InputVolumeChanged',
        payload: {
          inputName: String(v4Event.sourceName ?? ''),
          inputVolumeMul: mul,
          inputVolumeDb: mulToDb(mul),
        },
      };
    }
    case 'SourceAudioSyncOffsetChanged':
      return {
        internal: 'InputAudioSyncOffsetChanged',
        payload: {
          inputName: String(v4Event.sourceName ?? ''),
          inputAudioSyncOffset: Math.round(Number(v4Event.syncOffset ?? 0) / 1_000_000),
        },
      };
    case 'SourceCreated': {
      const typeId = String(v4Event.sourceKind ?? '');
      if (!isAudioKind(typeId)) return null;
      return {
        internal: 'InputCreated',
        payload: { inputName: String(v4Event.sourceName ?? ''), inputKind: typeId },
      };
    }
    case 'SourceDestroyed':
      return {
        internal: 'InputRemoved',
        payload: { inputName: String(v4Event.sourceName ?? '') },
      };
    case 'SourceRenamed':
      return {
        internal: 'InputNameChanged',
        payload: {
          inputName: String(v4Event.newName ?? ''),
          oldInputName: String(v4Event.previousName ?? ''),
        },
      };
    case 'StreamStarting':
    case 'StreamStarted':
    case 'StreamStopping':
    case 'StreamStopped':
      return {
        internal: 'StreamStateChanged',
        payload: { outputActive: updateType === 'StreamStarted' || updateType === 'StreamStarting' },
      };
    case 'RecordingStarting':
    case 'RecordingStarted':
    case 'RecordingStopping':
    case 'RecordingStopped':
      return {
        internal: 'RecordStateChanged',
        payload: {
          outputActive: updateType === 'RecordingStarted' || updateType === 'RecordingStarting',
          outputPaused: false,
        },
      };
    case 'RecordingPaused':
      return { internal: 'RecordStateChanged', payload: { outputActive: true, outputPaused: true } };
    case 'RecordingResumed':
      return { internal: 'RecordStateChanged', payload: { outputActive: true, outputPaused: false } };
    case 'ReplayStarting':
    case 'ReplayStarted':
    case 'ReplayStopping':
    case 'ReplayStopped':
      return {
        internal: 'ReplayBufferStateChanged',
        payload: { outputActive: updateType === 'ReplayStarted' || updateType === 'ReplayStarting' },
      };
    case 'SceneCollectionChanged':
      return {
        internal: 'CurrentSceneCollectionChanged',
        payload: { sceneCollectionName: String(v4Event['sc-name'] ?? '') },
      };
    case 'ProfileChanged':
      return {
        internal: 'CurrentProfileChanged',
        payload: { profileName: String(v4Event['profile-name'] ?? '') },
      };
    default:
      return null;
  }
}

/**
 * v4 source typeIds for audio-capable inputs. Mirrors what v5 surfaces as
 * audio-capable kinds; conservative — extra types just mean we expose more
 * UI rows, never less.
 *
 * Update history:
 * - 2026-05-13: initial allowlist (Windows / macOS / Linux native + media).
 * - 2026-05-13: expanded to include NDI, BlackMagic Decklink (both
 *   `decklink-input` and `decklink_input` spellings used by different
 *   plugin builds), application-audio capture, and `pulse_default`.
 *   Without these, `SourceCreated` events for NDI/Decklink/etc. would
 *   drop silently and the dashboard would never learn about new audio
 *   inputs added mid-session.
 */
const AUDIO_KINDS = new Set([
  // Windows
  'wasapi_input_capture',
  'wasapi_output_capture',
  'wasapi_process_output_capture',
  'application_audio_capture',
  'application_audio_output_capture',
  'dshow_input',
  // macOS
  'coreaudio_input_capture',
  'coreaudio_output_capture',
  // Linux
  'pulse_input_capture',
  'pulse_output_capture',
  'pulse_default',
  'alsa_input_capture',
  'jack_output_capture',
  // Plugins / cross-platform
  'audio_line',
  'browser_source',
  'ffmpeg_source',
  'vlc_source',
  'ndi_source',
  'decklink-input',
  'decklink_input',
]);

export function isAudioKind(typeId: string): boolean {
  return AUDIO_KINDS.has(typeId);
}

function parseTimecodeMs(tc: string): number {
  const match = /^(\d+):(\d+):(\d+)\.(\d+)$/.exec(tc);
  if (!match) return 0;
  const [, h, m, s, ms] = match;
  return (
    Number(h) * 3_600_000 +
    Number(m) * 60_000 +
    Number(s) * 1_000 +
    Number(ms)
  );
}
