import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encryptSecret, decryptSecret, parseMasterKey } from '../../src/secrets/crypto.js';

const masterKey = randomBytes(32);

describe('secret crypto (AES-256-GCM)', () => {
  it('round-trips a plaintext secret', () => {
    const secret = encryptSecret('sk-ant-super-secret', masterKey);
    expect(decryptSecret(secret, masterKey)).toBe('sk-ant-super-secret');
  });

  it('never stores the plaintext in the ciphertext', () => {
    const secret = encryptSecret('sk-ant-super-secret', masterKey);
    expect(secret.ciphertext.toString('utf8')).not.toContain('sk-ant');
    expect(secret.ciphertext.toString('latin1')).not.toContain('super-secret');
  });

  it('uses a fresh IV each call, so the same plaintext yields different ciphertext', () => {
    const a = encryptSecret('same-plaintext', masterKey);
    const b = encryptSecret('same-plaintext', masterKey);
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
    // ...yet both decrypt back to the same value.
    expect(decryptSecret(a, masterKey)).toBe('same-plaintext');
    expect(decryptSecret(b, masterKey)).toBe('same-plaintext');
  });

  it('rejects a tampered ciphertext (GCM auth failure)', () => {
    const secret = encryptSecret('sk-ant-super-secret', masterKey);
    const tampered = { ...secret, ciphertext: Buffer.from(secret.ciphertext) };
    tampered.ciphertext[0]! ^= 0xff;
    expect(() => decryptSecret(tampered, masterKey)).toThrow();
  });

  it('rejects a tampered auth tag', () => {
    const secret = encryptSecret('sk-ant-super-secret', masterKey);
    const tampered = { ...secret, authTag: Buffer.from(secret.authTag) };
    tampered.authTag[0]! ^= 0xff;
    expect(() => decryptSecret(tampered, masterKey)).toThrow();
  });

  it('fails to decrypt under a different master key', () => {
    const secret = encryptSecret('sk-ant-super-secret', masterKey);
    expect(() => decryptSecret(secret, randomBytes(32))).toThrow();
  });

  it('parses a valid 32-byte base64 master key', () => {
    const raw = randomBytes(32).toString('base64');
    expect(parseMasterKey(raw)).toHaveLength(32);
  });

  it('rejects a master key that does not decode to 32 bytes', () => {
    expect(() => parseMasterKey(randomBytes(16).toString('base64'))).toThrow(
      /MASTER_ENCRYPTION_KEY/,
    );
  });
});
