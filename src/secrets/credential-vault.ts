import type { Store } from '../store/types.js';
import { encryptSecret, decryptSecret } from './crypto.js';

/**
 * The per-installation secret boundary (Phase 12). Composes the `Store` (dumb byte
 * persistence) with the crypto layer so callers deal only in plaintext keys — the
 * ciphertext/iv/authTag triple never leaves this class. Both the run-time provider
 * resolver and (Phase 12b) the OAuth setup page go through here.
 */
export class CredentialVault {
  constructor(
    private readonly store: Store,
    private readonly masterKey: Buffer,
  ) {}

  /** Encrypt + persist (or rotate) an installation's Anthropic key. */
  async setAnthropicKey(installationId: number, apiKey: string): Promise<void> {
    const secret = encryptSecret(apiKey, this.masterKey);
    await this.store.upsertInstallationCredential({ installationId, ...secret });
  }

  /** Return the installation's plaintext Anthropic key, or null if none is on file. */
  async getAnthropicKey(installationId: number): Promise<string | null> {
    const secret = await this.store.getInstallationCredential(installationId);
    if (!secret) return null;
    return decryptSecret(secret, this.masterKey);
  }

  /** Purge an installation's stored key (on uninstall). No-op if nothing is on file. */
  async purge(installationId: number): Promise<void> {
    await this.store.deleteInstallationCredential(installationId);
  }
}
