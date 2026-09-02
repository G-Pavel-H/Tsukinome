import { describe, it, expect, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { InMemoryStore } from '../../src/store/memory-store.js';
import { CredentialVault } from '../../src/secrets/credential-vault.js';
import { readInstallationAuth, writeInstallationAuth } from '../../src/llm/installation-auth.js';

const masterKey = randomBytes(32);

describe('installation auth', () => {
  let store: InMemoryStore;
  let vault: CredentialVault;

  beforeEach(() => {
    store = new InMemoryStore();
    vault = new CredentialVault(store, masterKey);
  });

  it('returns null when the installation has nothing on file', async () => {
    expect(await readInstallationAuth(vault, store, 42)).toBeNull();
  });

  it('round-trips an API key', async () => {
    await writeInstallationAuth(vault, store, 42, 'api_key', 'sk-ant-42');
    expect(await readInstallationAuth(vault, store, 42)).toEqual({
      authType: 'api_key',
      secret: 'sk-ant-42',
    });
  });

  it('round-trips a subscription token', async () => {
    await writeInstallationAuth(vault, store, 42, 'subscription', 'sk-ant-oat-42');
    expect(await readInstallationAuth(vault, store, 42)).toEqual({
      authType: 'subscription',
      secret: 'sk-ant-oat-42',
    });
  });

  it('treats a credential written straight to the vault as an API key', async () => {
    // The Phase 12b setup page still writes through the vault alone; those rows predate the
    // discriminator and must keep resolving to the pay-as-you-go path.
    await vault.setAnthropicKey(42, 'sk-ant-legacy');
    expect(await readInstallationAuth(vault, store, 42)).toEqual({
      authType: 'api_key',
      secret: 'sk-ant-legacy',
    });
  });

  it('switches an installation between auth types without leaving a stale secret', async () => {
    await writeInstallationAuth(vault, store, 42, 'api_key', 'sk-ant-42');
    await writeInstallationAuth(vault, store, 42, 'subscription', 'sk-ant-oat-42');
    expect(await readInstallationAuth(vault, store, 42)).toEqual({
      authType: 'subscription',
      secret: 'sk-ant-oat-42',
    });
  });

  it('rotating a key through the vault preserves the recorded auth type', async () => {
    await writeInstallationAuth(vault, store, 42, 'subscription', 'sk-ant-oat-old');
    await vault.setAnthropicKey(42, 'sk-ant-oat-new');
    expect(await readInstallationAuth(vault, store, 42)).toEqual({
      authType: 'subscription',
      secret: 'sk-ant-oat-new',
    });
  });

  it('keeps installations isolated from one another', async () => {
    await writeInstallationAuth(vault, store, 1, 'api_key', 'sk-ant-one');
    await writeInstallationAuth(vault, store, 2, 'subscription', 'sk-ant-oat-two');
    expect(await readInstallationAuth(vault, store, 1)).toEqual({
      authType: 'api_key',
      secret: 'sk-ant-one',
    });
    expect(await readInstallationAuth(vault, store, 2)).toEqual({
      authType: 'subscription',
      secret: 'sk-ant-oat-two',
    });
  });

  it('forgets the auth type when the credential is purged', async () => {
    await writeInstallationAuth(vault, store, 42, 'subscription', 'sk-ant-oat-42');
    await vault.purge(42);
    expect(await readInstallationAuth(vault, store, 42)).toBeNull();
    expect(await store.getInstallationAuthType(42)).toBeNull();
  });
});
