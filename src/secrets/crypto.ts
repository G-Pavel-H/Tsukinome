import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

/**
 * Authenticated symmetric encryption for per-installation secrets (Phase 12).
 * AES-256-GCM: a 96-bit random IV per message + a 128-bit auth tag, so ciphertext
 * is confidential *and* tamper-evident. Plaintext keys are never logged or persisted —
 * only the {ciphertext, iv, authTag} triple lands in the DB.
 */

const ALGORITHM = 'aes-256-gcm';
/** GCM's standard nonce length (12 bytes / 96 bits). */
const IV_LENGTH = 12;
/** AES-256 key length. */
const KEY_LENGTH = 32;

/** The at-rest form of an encrypted secret — exactly what the store persists. */
export interface EncryptedSecret {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

/**
 * Decode + validate the operator's `MASTER_ENCRYPTION_KEY` (base64) into a 32-byte key.
 * Throws (at startup) if it isn't exactly 32 bytes, so a misconfigured key can never
 * silently produce weak/undecryptable secrets.
 */
export function parseMasterKey(raw: string): Buffer {
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `MASTER_ENCRYPTION_KEY must decode to ${KEY_LENGTH} bytes (got ${key.length}); ` +
        'generate one with `openssl rand -base64 32`',
    );
  }
  return key;
}

export function encryptSecret(plaintext: string, masterKey: Buffer): EncryptedSecret {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, masterKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { ciphertext, iv, authTag };
}

/** Decrypt, verifying the auth tag. Throws if the ciphertext/tag/key don't match. */
export function decryptSecret(secret: EncryptedSecret, masterKey: Buffer): string {
  const decipher = createDecipheriv(ALGORITHM, masterKey, secret.iv);
  decipher.setAuthTag(secret.authTag);
  const plaintext = Buffer.concat([decipher.update(secret.ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}
