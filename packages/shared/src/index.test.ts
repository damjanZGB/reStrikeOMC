import { describe, it, expect } from 'vitest';
import { PROTOCOL_VERSION } from './index.js';

describe('shared package', () => {
  it('exposes a protocol version constant', () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });
});
