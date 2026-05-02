import { describe, it, expect } from 'vitest';
import { StateStore } from './state-store.js';

const ID = '00000000-0000-0000-0000-000000000001';

describe('StateStore', () => {
  it('initializes a connection with default state', () => {
    const s = new StateStore();
    s.upsertConnection(ID);
    const snap = s.snapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0]!.connId).toBe(ID);
    expect(snap[0]!.status).toBe('connecting');
  });

  it('applies a partial diff', () => {
    const s = new StateStore();
    s.upsertConnection(ID);
    s.applyDiff({ connId: ID, status: 'connected', currentProgramScene: 'A' });
    const snap = s.snapshot();
    expect(snap[0]!.status).toBe('connected');
    expect(snap[0]!.currentProgramScene).toBe('A');
  });

  it('removes a connection', () => {
    const s = new StateStore();
    s.upsertConnection(ID);
    s.remove(ID);
    expect(s.snapshot()).toEqual([]);
  });

  it('ignores diff for unknown connection', () => {
    const s = new StateStore();
    s.applyDiff({ connId: ID, status: 'connected' });
    expect(s.snapshot()).toEqual([]);
  });
});
