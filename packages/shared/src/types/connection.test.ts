import { describe, it, expect } from 'vitest';
import { ConnectionConfigSchema, type ConnectionConfig } from './connection.js';

describe('ConnectionConfigSchema', () => {
  it('accepts a minimal connection', () => {
    const input: ConnectionConfig = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Studio A',
      host: '192.168.1.50',
      port: 4455,
      hasPassword: true,
    };
    expect(ConnectionConfigSchema.parse(input)).toEqual(input);
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
