import { describe, it, expect } from 'vitest';
import {
  translateRequest,
  translateResponse,
  translateEvent,
  isAudioKind,
  type SceneItemLookup,
} from './v4-translate.js';

const lookup = (entries: Array<[string, number, string]>): SceneItemLookup => ({
  itemNameForId: (scene, id) => {
    const e = entries.find(([s, i]) => s === scene && i === id);
    return e ? e[2] : null;
  },
});

describe('translateRequest — scene + transition commands', () => {
  it('SetCurrentProgramScene -> SetCurrentScene with kebab-case key', () => {
    expect(translateRequest('SetCurrentProgramScene', { sceneName: 'Cam 1' })).toEqual({
      v4Type: 'SetCurrentScene',
      v4Payload: { 'scene-name': 'Cam 1' },
    });
  });

  it('SetCurrentPreviewScene -> SetPreviewScene', () => {
    expect(translateRequest('SetCurrentPreviewScene', { sceneName: 'Cam 2' })).toEqual({
      v4Type: 'SetPreviewScene',
      v4Payload: { 'scene-name': 'Cam 2' },
    });
  });

  it('SetStudioModeEnabled branches verb on boolean', () => {
    expect(translateRequest('SetStudioModeEnabled', { enabled: true }).v4Type).toBe(
      'EnableStudioMode'
    );
    expect(translateRequest('SetStudioModeEnabled', { enabled: false }).v4Type).toBe(
      'DisableStudioMode'
    );
  });

  it('TransitionToProgram emits empty payload when no opts given', () => {
    expect(translateRequest('TransitionToProgram', {})).toEqual({
      v4Type: 'TransitionToProgram',
      v4Payload: {},
    });
  });

  it('TransitionToProgram nests name + duration under with-transition', () => {
    expect(
      translateRequest('TransitionToProgram', {
        transitionName: 'Cut',
        transitionDurationMs: 300,
      })
    ).toEqual({
      v4Type: 'TransitionToProgram',
      v4Payload: { 'with-transition': { name: 'Cut', duration: 300 } },
    });
  });

  it('SetCurrentSceneTransition -> SetCurrentTransition', () => {
    expect(
      translateRequest('SetCurrentSceneTransition', { transitionName: 'Fade' })
    ).toEqual({
      v4Type: 'SetCurrentTransition',
      v4Payload: { 'transition-name': 'Fade' },
    });
  });

  it('SetCurrentSceneTransitionDuration -> SetTransitionDuration', () => {
    expect(
      translateRequest('SetCurrentSceneTransitionDuration', { transitionDurationMs: 500 })
    ).toEqual({
      v4Type: 'SetTransitionDuration',
      v4Payload: { duration: 500 },
    });
  });
});

describe('translateRequest — scene item visibility (gap 1)', () => {
  it('resolves sceneItemId via the SceneItemLookup', () => {
    const ctx = {
      sceneItems: lookup([['Scene 1', 42, 'BRB']]),
    };
    expect(
      translateRequest(
        'SetSceneItemEnabled',
        { sceneName: 'Scene 1', sceneItemId: 42, sceneItemEnabled: true },
        ctx
      )
    ).toEqual({
      v4Type: 'SetSceneItemProperties',
      v4Payload: {
        'scene-name': 'Scene 1',
        item: { name: 'BRB' },
        visible: true,
      },
    });
  });

  it('throws a lookup-miss error when the cache does not have the item', () => {
    expect(() =>
      translateRequest(
        'SetSceneItemEnabled',
        { sceneName: 'Scene 1', sceneItemId: 7, sceneItemEnabled: false },
        { sceneItems: lookup([]) }
      )
    ).toThrow(/lookup miss/);
  });
});

describe('translateRequest — audio commands', () => {
  it('SetInputMute -> SetMute with source/mute keys', () => {
    expect(translateRequest('SetInputMute', { inputName: 'Mic', muted: true })).toEqual({
      v4Type: 'SetMute',
      v4Payload: { source: 'Mic', mute: true },
    });
  });

  it('SetInputVolume uses volumeMul directly when provided', () => {
    expect(
      translateRequest('SetInputVolume', { inputName: 'Mic', volumeMul: 0.5 })
    ).toEqual({
      v4Type: 'SetVolume',
      v4Payload: { source: 'Mic', volume: 0.5 },
    });
  });

  it('SetInputVolume converts dB to mul when only dB is given', () => {
    const r = translateRequest('SetInputVolume', { inputName: 'Mic', volumeDb: -6 });
    expect(r.v4Type).toBe('SetVolume');
    const mul = (r.v4Payload as { volume: number }).volume;
    expect(mul).toBeGreaterThan(0.45);
    expect(mul).toBeLessThan(0.55);
  });

  it('SetInputAudioSyncOffset converts ms to nanoseconds', () => {
    expect(
      translateRequest('SetInputAudioSyncOffset', { inputName: 'Mic', syncOffsetMs: 20 })
    ).toEqual({
      v4Type: 'SetSyncOffset',
      v4Payload: { source: 'Mic', offset: 20_000_000 },
    });
  });
});

describe('translateRequest — output toggles', () => {
  it.each([
    ['ToggleStream', 'StartStopStreaming'],
    ['ToggleRecord', 'StartStopRecording'],
    ['ToggleReplayBuffer', 'StartStopReplayBuffer'],
    ['SaveReplayBuffer', 'SaveReplayBuffer'],
    ['ToggleVirtualCam', 'StartStopVirtualCam'],
  ])('%s -> %s', (internal, v4Type) => {
    expect(translateRequest(internal, {}).v4Type).toBe(v4Type);
  });

  it('ToggleRecordPause picks Pause when not paused', () => {
    expect(translateRequest('ToggleRecordPause', {}, { recordPaused: false }).v4Type).toBe(
      'PauseRecording'
    );
  });

  it('ToggleRecordPause picks Resume when already paused', () => {
    expect(translateRequest('ToggleRecordPause', {}, { recordPaused: true }).v4Type).toBe(
      'ResumeRecording'
    );
  });
});

describe('translateRequest — hotkey + collection + profile', () => {
  it('TriggerHotkeyByName passes hotkeyName through', () => {
    expect(translateRequest('TriggerHotkeyByName', { hotkeyName: 'GO_LIVE' })).toEqual({
      v4Type: 'TriggerHotkeyByName',
      v4Payload: { hotkeyName: 'GO_LIVE' },
    });
  });

  it('SetCurrentSceneCollection -> sc-name', () => {
    expect(
      translateRequest('SetCurrentSceneCollection', { sceneCollectionName: 'Main' })
    ).toEqual({
      v4Type: 'SetCurrentSceneCollection',
      v4Payload: { 'sc-name': 'Main' },
    });
  });

  it('SetCurrentProfile -> profile-name', () => {
    expect(translateRequest('SetCurrentProfile', { profileName: 'Default' })).toEqual({
      v4Type: 'SetCurrentProfile',
      v4Payload: { 'profile-name': 'Default' },
    });
  });
});

describe('translateRequest — error path', () => {
  it('throws on unknown command', () => {
    expect(() => translateRequest('GetSomethingFake', {})).toThrow(/unsupported_v4_command/);
  });
});

describe('translateResponse — snapshot reads', () => {
  it('GetSceneList reshapes v4 current-scene + scenes', () => {
    const out = translateResponse('GetSceneList', {
      'current-scene': 'A',
      scenes: [{ name: 'A' }, { name: 'B' }],
    });
    expect(out).toEqual({
      currentProgramSceneName: 'A',
      currentPreviewSceneName: null,
      scenes: [
        { sceneName: 'A', sceneIndex: 0 },
        { sceneName: 'B', sceneIndex: 1 },
      ],
    });
  });

  it('GetInputList filters non-audio source kinds and maps fields', () => {
    const out = translateResponse('GetInputList', {
      sources: [
        { name: 'Mic', typeId: 'wasapi_input_capture', type: 'input' },
        { name: 'Screen', typeId: 'monitor_capture', type: 'input' },
        { name: 'Cam', typeId: 'dshow_input', type: 'input' },
      ],
    });
    expect(out).toEqual({
      inputs: [
        { inputName: 'Mic', inputKind: 'wasapi_input_capture' },
        { inputName: 'Cam', inputKind: 'dshow_input' },
      ],
    });
  });

  it('GetStreamStatus -> outputActive', () => {
    expect(translateResponse('GetStreamStatus', { streaming: true, 'total-stream-time': 12 }))
      .toEqual({ outputActive: true, outputDuration: 12_000 });
  });

  it('GetReplayBufferStatus accepts either casing', () => {
    expect(
      translateResponse('GetReplayBufferStatus', { 'is-replay-buffer-active': true })
    ).toEqual({ outputActive: true });
    expect(
      translateResponse('GetReplayBufferStatus', { isReplayBufferActive: true })
    ).toEqual({ outputActive: true });
  });

  it('GetVirtualCamStatus normalizes to outputActive', () => {
    expect(translateResponse('GetVirtualCamStatus', { isVirtualCam: true })).toEqual({
      outputActive: true,
    });
  });

  it('GetInputVolume converts linear mul to inputVolumeMul + dB', () => {
    const out = translateResponse('GetInputVolume', { volume: 0.5 }) as {
      inputVolumeMul: number;
      inputVolumeDb: number;
    };
    expect(out.inputVolumeMul).toBe(0.5);
    expect(out.inputVolumeDb).toBeGreaterThan(-6.5);
    expect(out.inputVolumeDb).toBeLessThan(-5.5);
  });

  it('GetSceneItemList reshapes v4 items into sceneItemId/sourceName', () => {
    expect(
      translateResponse('GetSceneItemList', {
        'scene-items': [
          { itemId: 1, sourceName: 'BRB' },
          { itemId: 2, sourceName: 'Cam' },
        ],
      })
    ).toEqual({
      sceneItems: [
        { sceneItemId: 1, sourceName: 'BRB' },
        { sceneItemId: 2, sourceName: 'Cam' },
      ],
    });
  });

  it('returns null for non-reshaped response types', () => {
    expect(translateResponse('SetCurrentProgramScene', {})).toBeNull();
  });
});

describe('translateEvent — v4 update-type to internal name', () => {
  it('SwitchScenes -> CurrentProgramSceneChanged', () => {
    expect(translateEvent({ 'update-type': 'SwitchScenes', 'scene-name': 'A' })).toEqual({
      internal: 'CurrentProgramSceneChanged',
      payload: { sceneName: 'A' },
    });
  });

  it('SourceMuteStateChanged -> InputMuteStateChanged', () => {
    expect(
      translateEvent({ 'update-type': 'SourceMuteStateChanged', sourceName: 'Mic', muted: true })
    ).toEqual({
      internal: 'InputMuteStateChanged',
      payload: { inputName: 'Mic', inputMuted: true },
    });
  });

  it('SourceVolumeChanged -> InputVolumeChanged with derived dB', () => {
    const out = translateEvent({
      'update-type': 'SourceVolumeChanged',
      sourceName: 'Mic',
      volume: 0.25,
    });
    expect(out?.internal).toBe('InputVolumeChanged');
    const p = out?.payload as { inputVolumeDb: number; inputVolumeMul: number; inputName: string };
    expect(p.inputName).toBe('Mic');
    expect(p.inputVolumeMul).toBe(0.25);
    expect(p.inputVolumeDb).toBeLessThan(-11);
    expect(p.inputVolumeDb).toBeGreaterThan(-13);
  });

  it('SourceCreated drops non-audio kinds', () => {
    expect(
      translateEvent({ 'update-type': 'SourceCreated', sourceName: 'Cam', sourceKind: 'monitor_capture' })
    ).toBeNull();
  });

  it('SourceCreated keeps audio kinds', () => {
    expect(
      translateEvent({ 'update-type': 'SourceCreated', sourceName: 'Mic', sourceKind: 'wasapi_input_capture' })
    ).toEqual({
      internal: 'InputCreated',
      payload: { inputName: 'Mic', inputKind: 'wasapi_input_capture' },
    });
  });

  it.each([
    ['StreamStarted', true],
    ['StreamStarting', true],
    ['StreamStopping', false],
    ['StreamStopped', false],
  ])('%s -> StreamStateChanged outputActive=%s', (updateType, expected) => {
    const out = translateEvent({ 'update-type': updateType });
    expect(out?.internal).toBe('StreamStateChanged');
    expect((out?.payload as { outputActive: boolean }).outputActive).toBe(expected);
  });

  it.each([
    ['RecordingStarted', true, false],
    ['RecordingStopped', false, false],
    ['RecordingPaused', true, true],
    ['RecordingResumed', true, false],
  ])('%s -> RecordStateChanged active=%s paused=%s', (updateType, active, paused) => {
    const out = translateEvent({ 'update-type': updateType });
    expect(out?.internal).toBe('RecordStateChanged');
    const p = out?.payload as { outputActive: boolean; outputPaused: boolean };
    expect(p.outputActive).toBe(active);
    expect(p.outputPaused).toBe(paused);
  });

  it('Heartbeat is dropped', () => {
    expect(translateEvent({ 'update-type': 'Heartbeat' })).toBeNull();
  });
});

describe('isAudioKind', () => {
  it.each([
    ['wasapi_input_capture', true],
    ['dshow_input', true],
    ['monitor_capture', false],
    ['game_capture', false],
    // P1-8 allowlist expansion: NDI, BlackMagic (both spellings),
    // application-audio, and pulse_default were missing pre-2026-05-13.
    // Adding tests pins them so a future cleanup pass doesn't quietly
    // shrink the set again.
    ['ndi_source', true],
    ['decklink-input', true],
    ['decklink_input', true],
    ['application_audio_capture', true],
    ['application_audio_output_capture', true],
    ['pulse_default', true],
  ])('%s -> %s', (typeId, expected) => {
    expect(isAudioKind(typeId)).toBe(expected);
  });
});

// P1-17: NaN guard. v4 peers occasionally send non-numeric "volume" — the
// raw Number() coercion would turn that into NaN, which then propagates
// through mulToDb and gives the dashboard a NaN-dB readout indistinguishable
// from a real mute. safeNumber falls back to 0 instead.
describe('translateResponse — NaN safety', () => {
  it('GetInputVolume coerces non-numeric volume to 0 mul / -100 dB', () => {
    const out = translateResponse('GetInputVolume', { volume: 'loud' }) as {
      inputVolumeMul: number;
      inputVolumeDb: number;
    };
    expect(out.inputVolumeMul).toBe(0);
    expect(out.inputVolumeDb).toBe(-100);
  });

  it('GetInputVolume coerces NaN to 0', () => {
    const out = translateResponse('GetInputVolume', { volume: NaN }) as {
      inputVolumeMul: number;
    };
    expect(out.inputVolumeMul).toBe(0);
  });
});

describe('translateEvent — NaN safety', () => {
  it('SourceVolumeChanged coerces non-numeric volume to 0', () => {
    const out = translateEvent({
      'update-type': 'SourceVolumeChanged',
      sourceName: 'Mic',
      volume: 'broken',
    });
    expect(out?.internal).toBe('InputVolumeChanged');
    const p = out?.payload as { inputVolumeMul: number; inputVolumeDb: number };
    expect(p.inputVolumeMul).toBe(0);
    expect(p.inputVolumeDb).toBe(-100);
  });
});
