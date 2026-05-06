/**
 * Priority logic for picking the tile's accent color from its live state.
 *
 * Tests pin the rules explicitly so a future refactor can't silently re-order
 * the priority — e.g. if "recording" started winning over "streaming", users
 * would lose the visual cue that the broadcast is live.
 */
import { describe, it, expect } from 'vitest';
import type { InstanceState } from '@restrike/shared';
import { getTileStateColor } from './tile-state';

function liveState(overrides: Partial<InstanceState> = {}): InstanceState {
  return {
    connId: '00000000-0000-0000-0000-000000000001',
    status: 'connected',
    currentProgramScene: 'Live',
    currentPreviewScene: null,
    studioMode: false,
    scenes: [],
    inputs: [],
    outputs: {
      streaming: { active: false, durationMs: 0 },
      recording: { active: false, paused: false, durationMs: 0 },
      replayBuffer: { active: false },
      virtualCam: { active: false },
    },
    stats: null,
    ...overrides,
  };
}

describe('getTileStateColor', () => {
  it("undefined live → 'subtle' (backend hasn't connected yet)", () => {
    expect(getTileStateColor(undefined)).toBe('subtle');
  });

  it("auth_failed → 'bad' (red — needs user attention)", () => {
    expect(getTileStateColor(liveState({ status: 'auth_failed' }))).toBe('bad');
  });

  it("disconnected → 'subtle' (gray — neutral, not an error)", () => {
    expect(getTileStateColor(liveState({ status: 'disconnected' }))).toBe('subtle');
  });

  it("connecting → 'warn' (amber — transient state)", () => {
    expect(getTileStateColor(liveState({ status: 'connecting' }))).toBe('warn');
  });

  it("streaming wins over recording (highest-priority active)", () => {
    expect(
      getTileStateColor(
        liveState({
          outputs: {
            streaming: { active: true, durationMs: 0 },
            recording: { active: true, paused: false, durationMs: 0 },
            replayBuffer: { active: true },
            virtualCam: { active: true },
          },
        })
      )
    ).toBe('live');
  });

  it("recording without streaming → 'record'", () => {
    expect(
      getTileStateColor(
        liveState({
          outputs: {
            streaming: { active: false, durationMs: 0 },
            recording: { active: true, paused: false, durationMs: 0 },
            replayBuffer: { active: false },
            virtualCam: { active: false },
          },
        })
      )
    ).toBe('record');
  });

  it("replay buffer armed without stream/record → 'replay'", () => {
    expect(
      getTileStateColor(
        liveState({
          outputs: {
            streaming: { active: false, durationMs: 0 },
            recording: { active: false, paused: false, durationMs: 0 },
            replayBuffer: { active: true },
            virtualCam: { active: false },
          },
        })
      )
    ).toBe('replay');
  });

  it("virtual cam only → 'vcam'", () => {
    expect(
      getTileStateColor(
        liveState({
          outputs: {
            streaming: { active: false, durationMs: 0 },
            recording: { active: false, paused: false, durationMs: 0 },
            replayBuffer: { active: false },
            virtualCam: { active: true },
          },
        })
      )
    ).toBe('vcam');
  });

  it("connected with a preview scene set → 'preview'", () => {
    expect(getTileStateColor(liveState({ currentPreviewScene: 'Halftime' }))).toBe('preview');
  });

  it("connected idle (no outputs, no preview) → 'ok'", () => {
    expect(getTileStateColor(liveState())).toBe('ok');
  });

  it("degraded but otherwise idle → 'ok' (treat like connected)", () => {
    expect(getTileStateColor(liveState({ status: 'degraded' }))).toBe('ok');
  });
});
