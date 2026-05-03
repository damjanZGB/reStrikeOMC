import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventCoalescer, FLUSH_INTERVAL_MS } from './event-coalescer.js';

const ID = '00000000-0000-0000-0000-000000000001';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('EventCoalescer', () => {
  it('flushes scene change immediately (high-priority)', () => {
    const flush = vi.fn();
    const c = new EventCoalescer(flush);
    c.handle(ID, 'CurrentProgramSceneChanged', { sceneName: 'X' });
    expect(flush).toHaveBeenCalledWith(
      expect.objectContaining({ connId: ID, currentProgramScene: 'X' })
    );
  });

  it('coalesces InputVolumeMeters at 30 Hz (latest wins)', () => {
    const flush = vi.fn();
    const c = new EventCoalescer(flush);
    for (let i = 0; i < 10; i++) {
      c.handle(ID, 'InputVolumeMeters', {
        inputs: [{ inputName: 'Mic', inputLevelsMul: [[0.1 * i, 0.2 * i, 0.3 * i]] }],
      });
    }
    expect(flush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(FLUSH_INTERVAL_MS + 1);
    expect(flush).toHaveBeenCalledTimes(1);
    const diff = flush.mock.calls[0]![0];
    expect(diff.connId).toBe(ID);
    expect(diff.inputs).toBeDefined();
  });

  it('exposes destroy() that stops the flush timer', () => {
    const flush = vi.fn();
    const c = new EventCoalescer(flush);
    c.handle(ID, 'InputVolumeMeters', { inputs: [] });
    c.destroy();
    vi.advanceTimersByTime(1000);
    expect(flush).not.toHaveBeenCalled();
  });

  it('emits only the changed output sub-key (no sibling clobber)', () => {
    const flush = vi.fn();
    const c = new EventCoalescer(flush);
    c.handle(ID, 'StreamStateChanged', { outputActive: true });
    expect(flush).toHaveBeenCalledTimes(1);
    const diff = flush.mock.calls[0]![0];
    expect(diff.connId).toBe(ID);
    expect(diff.outputs).toEqual({ streaming: { active: true, durationMs: 0 } });
    // recording / replayBuffer / virtualCam must be ABSENT from the diff
    expect(diff.outputs.recording).toBeUndefined();
    expect(diff.outputs.replayBuffer).toBeUndefined();
    expect(diff.outputs.virtualCam).toBeUndefined();
  });

  it.each([
    ['RecordStateChanged', { outputActive: true, outputPaused: false }, 'recording'],
    ['ReplayBufferStateChanged', { outputActive: true }, 'replayBuffer'],
    ['VirtualcamStateChanged', { outputActive: true }, 'virtualCam'],
  ] as const)('translates %s into a partial outputs diff', (event, payload, key) => {
    const flush = vi.fn();
    const c = new EventCoalescer(flush);
    c.handle(ID, event, payload);
    const diff = flush.mock.calls[0]![0];
    expect(diff.outputs).toBeDefined();
    expect(Object.keys(diff.outputs)).toEqual([key]);
  });
});
