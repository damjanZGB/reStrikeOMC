import { describe, it, expect } from 'vitest';
import {
  ServerMessageSchema,
  ClientMessageSchema,
} from './messages.js';

describe('WS protocol messages', () => {
  it('parses server state.snapshot message', () => {
    const msg = {
      type: 'state.snapshot',
      states: [],
    };
    const parsed = ServerMessageSchema.parse(msg);
    expect(parsed.type).toBe('state.snapshot');
  });

  it('parses server state.diff message', () => {
    const msg = {
      type: 'state.diff',
      diff: { connId: '550e8400-e29b-41d4-a716-446655440000', status: 'connected' },
    };
    expect(ServerMessageSchema.parse(msg)).toEqual(msg);
  });

  it('parses server cmd.result message', () => {
    const msg = {
      type: 'cmd.result',
      id: 'req-1',
      ok: ['550e8400-e29b-41d4-a716-446655440001'],
      failed: [{ connId: '550e8400-e29b-41d4-a716-446655440002', code: 'SceneNotFound', message: 'no such scene' }],
    };
    expect(ServerMessageSchema.parse(msg)).toEqual(msg);
  });

  it('parses client cmd message', () => {
    const msg = {
      type: 'cmd',
      id: 'req-1',
      action: 'SetCurrentProgramScene',
      targets: ['550e8400-e29b-41d4-a716-446655440000'],
      payload: { sceneName: 'Scene 1' },
    };
    expect(ClientMessageSchema.parse(msg)).toEqual(msg);
  });

  it('parses client sync message', () => {
    expect(ClientMessageSchema.parse({ type: 'sync' })).toEqual({ type: 'sync' });
  });

  it('rejects unknown message type', () => {
    expect(() => ServerMessageSchema.parse({ type: 'unknown' })).toThrow();
  });
});
