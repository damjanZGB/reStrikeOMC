import { describe, it, expect } from 'vitest';
import { ConnectionConfigSchema, type ConnectionConfig } from './connection.js';

describe('ConnectionConfigSchema', () => {
  it('accepts a minimal connection and defaults protocol to null', () => {
    const input = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Studio A',
      host: '192.168.1.50',
      port: 4455,
      hasPassword: true,
    };
    const expected: ConnectionConfig = { ...input, protocol: null };
    expect(ConnectionConfigSchema.parse(input)).toEqual(expected);
  });

  it('accepts explicit protocol v4', () => {
    const out = ConnectionConfigSchema.parse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Legacy',
      host: '1.2.3.4',
      port: 4444,
      hasPassword: false,
      protocol: 'v4',
    });
    expect(out.protocol).toBe('v4');
  });

  it('rejects invalid protocol values', () => {
    expect(() =>
      ConnectionConfigSchema.parse({
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'X',
        host: '1.2.3.4',
        port: 4455,
        hasPassword: false,
        protocol: 'v3',
      })
    ).toThrow();
  });

  it('rejects invalid port', () => {
    expect(() =>
      ConnectionConfigSchema.parse({
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'X',
        host: '1.2.3.4',
        port: 99999,
        hasPassword: false,
      })
    ).toThrow();
  });

  it('rejects empty name', () => {
    expect(() =>
      ConnectionConfigSchema.parse({
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: '',
        host: '1.2.3.4',
        port: 4455,
        hasPassword: false,
      })
    ).toThrow();
  });
});
