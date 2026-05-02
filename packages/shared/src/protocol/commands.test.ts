import { describe, it, expect } from 'vitest';
import { COMMAND_SCHEMAS, type CommandName } from './commands.js';

describe('command schemas', () => {
  it('validates SetCurrentProgramScene payload', () => {
    const schema = COMMAND_SCHEMAS.SetCurrentProgramScene;
    expect(schema.parse({ sceneName: 'Scene 1' })).toEqual({ sceneName: 'Scene 1' });
    expect(() => schema.parse({})).toThrow();
  });

  it('validates SetInputMute payload', () => {
    const schema = COMMAND_SCHEMAS.SetInputMute;
    expect(schema.parse({ inputName: 'Mic', muted: true })).toEqual({
      inputName: 'Mic',
      muted: true,
    });
  });

  it('validates SetInputVolume payload (mul or db)', () => {
    const schema = COMMAND_SCHEMAS.SetInputVolume;
    expect(schema.parse({ inputName: 'Mic', volumeMul: 0.5 })).toEqual({
      inputName: 'Mic',
      volumeMul: 0.5,
    });
    expect(schema.parse({ inputName: 'Mic', volumeDb: -6 })).toEqual({
      inputName: 'Mic',
      volumeDb: -6,
    });
    expect(() => schema.parse({ inputName: 'Mic' })).toThrow();
  });

  it('validates ToggleStream payload (no params)', () => {
    expect(COMMAND_SCHEMAS.ToggleStream.parse({})).toEqual({});
  });

  it('exhaustively lists every command', () => {
    const expected: CommandName[] = [
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
    ];
    expect(Object.keys(COMMAND_SCHEMAS).sort()).toEqual(expected.sort());
  });
});
