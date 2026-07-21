import { describe, it, expect, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { InMemoryStore } from '../../src/store/memory-store.js';
import { CredentialVault } from '../../src/secrets/credential-vault.js';

const masterKey = randomBytes(32);

describe('CredentialVault', () => {
  let store: InMemoryStore;
  let vault: CredentialVault;
  beforeEach(() => {
    store = new InMemoryStore();
    vault = new CredentialVault(store, masterKey);
  });

  it('returns null when no key is on file for the installation', async () => {
    expect(await vault.getAnthropicKey(42)).toBeNull();
  });

  it('sets then reads back the plaintext key', async () => {
    await vault.setAnthropicKey(42, 'sk-ant-installation-42');
    expect(await vault.getAnthropicKey(42)).toBe('sk-ant-installation-42');
  });

  it('persists ciphertext at rest, never the plaintext', async () => {
    await vault.setAnthropicKey(42, 'sk-ant-installation-42');
    const stored = await store.getInstallationCredential(42);
    expect(stored).not.toBeNull();
    expect(stored!.ciphertext.toString('utf8')).not.toContain('sk-ant');
    expect(stored!.iv).toHaveLength(12);
    expect(stored!.authTag.length).toBeGreaterThan(0);
  });

  it('rotates the key in place (upsert), returning the latest', async () => {
    await vault.setAnthropicKey(42, 'sk-ant-old');
    await vault.setAnthropicKey(42, 'sk-ant-new');
    expect(await vault.getAnthropicKey(42)).toBe('sk-ant-new');
  });

  it('keeps installations isolated from one another', async () => {
    await vault.setAnthropicKey(1, 'sk-ant-one');
    await vault.setAnthropicKey(2, 'sk-ant-two');
    expect(await vault.getAnthropicKey(1)).toBe('sk-ant-one');
    expect(await vault.getAnthropicKey(2)).toBe('sk-ant-two');
  });

  it('purges a key on uninstall', async () => {
    await vault.setAnthropicKey(42, 'sk-ant-installation-42');
    await vault.purge(42);
    expect(await vault.getAnthropicKey(42)).toBeNull();
    expect(await store.getInstallationCredential(42)).toBeNull();
  });

  it('purge is a no-op when nothing is on file', async () => {
    await expect(vault.purge(999)).resolves.toBeUndefined();
  });
});
