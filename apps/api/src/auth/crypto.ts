import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'node:crypto';

const ALG = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const SALT = Buffer.from('restrike-omc-fixed-salt-v1', 'utf8');

export function deriveKeyFromString(secret: string): Buffer {
  if (secret.length < 16) {
    throw new Error('CONNECTION_PASSWORD_KEY must be at least 16 chars');
  }
  return scryptSync(secret, SALT, 32);
}

export function encrypt(key: Buffer, plaintext: string): {
  ciphertext: Buffer;
  iv: Buffer;
} {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALG, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: Buffer.concat([enc, tag]), iv };
}

export function decrypt(key: Buffer, ciphertext: Buffer, iv: Buffer): string {
  const enc = ciphertext.subarray(0, ciphertext.length - TAG_LEN);
  const tag = ciphertext.subarray(ciphertext.length - TAG_LEN);
  const decipher = createDecipheriv(ALG, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}
