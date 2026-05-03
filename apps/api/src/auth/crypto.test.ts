import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, deriveKeyFromString } from './crypto.js';

const KEY_STRING = 'this-is-a-fixed-test-key-32-byte-long!';

describe('crypto utils', () => {
  it('encrypts and decrypts a string round-trip', () => {
    const key = deriveKeyFromString(KEY_STRING);
    const { ciphertext, iv } = encrypt(key, 'super-secret-password');
    expect(ciphertext.length).toBeGreaterThan(0);
    expect(iv.length).toBe(12);
    expect(decrypt(key, ciphertext, iv)).toBe('super-secret-password');
  });

  it('produces different ciphertext for the same plaintext (random IV)', () => {
    const key = deriveKeyFromString(KEY_STRING);
    const a = encrypt(key, 'x');
    const b = encrypt(key, 'x');
    expect(Buffer.compare(a.ciphertext, b.ciphertext)).not.toBe(0);
  });

  it('rejects tampered ciphertext', () => {
    const key = deriveKeyFromString(KEY_STRING);
    const { ciphertext, iv } = encrypt(key, 'x');
    const byte = ciphertext[0]!;
    ciphertext[0] = byte === 0 ? 1 : byte ^ 1;
    expect(() => decrypt(key, ciphertext, iv)).toThrow();
  });
});
