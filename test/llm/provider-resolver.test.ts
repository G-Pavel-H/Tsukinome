import { describe, it, expect, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { InMemoryStore } from '../../src/store/memory-store.js';
import { CredentialVault } from '../../src/secrets/credential-vault.js';
import {
  buildProviderResolver,
  MissingInstallationKeyError,
} from '../../src/llm/provider-resolver.js';
import { writeInstallationAuth } from '../../src/llm/installation-auth.js';
import type { LlmProvider } from '../../src/llm/types.js';

const masterKey = randomBytes(32);

/** A provider whose only observable properties are the secret and kind it was built from. */
function fakeProviderFor(kind: 'api_key' | 'subscription', secret: string) {
  return {
    kind,
    secret,
    async createMessage() {
      throw new Error('not used in resolver tests');
    },
  } satisfies LlmProvider & { kind: string; secret: string };
}

type FakeProvider = ReturnType<typeof fakeProviderFor>;

describe('buildProviderResolver', () => {
  let store: InMemoryStore;
  let vault: CredentialVault;
  const factory = (apiKey: string) => fakeProviderFor('api_key', apiKey);
  const subscriptionFactory = (token: string) => fakeProviderFor('subscription', token);

  beforeEach(() => {
    store = new InMemoryStore();
    vault = new CredentialVault(store, masterKey);
  });

  /** The default wiring under test: BYO API key, subscription auth switched off. */
  function resolver(over: Record<string, unknown> = {}) {
    return buildProviderResolver({ vault, store, factory, subscriptionFactory, ...over });
  }

  it("builds a provider from the installation's own stored key", async () => {
    await vault.setAnthropicKey(42, 'sk-ant-42');
    expect(((await resolver()(42)) as FakeProvider).secret).toBe('sk-ant-42');
  });

  it('resolves different installations to different keys (per-run isolation)', async () => {
    await vault.setAnthropicKey(1, 'sk-ant-one');
    await vault.setAnthropicKey(2, 'sk-ant-two');
    const resolve = resolver();
    expect(((await resolve(1)) as FakeProvider).secret).toBe('sk-ant-one');
    expect(((await resolve(2)) as FakeProvider).secret).toBe('sk-ant-two');
  });

  it('refuses with MissingInstallationKeyError when no key is on file and fallback is off', async () => {
    await expect(resolver()(42)).rejects.toBeInstanceOf(MissingInstallationKeyError);
  });

  it('does not fall back to the platform key unless fallback is explicitly enabled', async () => {
    const resolve = resolver({ allowPlatformFallback: false, platformKey: 'sk-ant-platform' });
    await expect(resolve(42)).rejects.toBeInstanceOf(MissingInstallationKeyError);
  });

  it('falls back to the operator platform key when fallback is enabled and no key is on file', async () => {
    const resolve = resolver({ allowPlatformFallback: true, platformKey: 'sk-ant-platform' });
    expect(((await resolve(42)) as FakeProvider).secret).toBe('sk-ant-platform');
  });

  it("prefers the installation's own key over the platform fallback", async () => {
    await vault.setAnthropicKey(42, 'sk-ant-42');
    const resolve = resolver({ allowPlatformFallback: true, platformKey: 'sk-ant-platform' });
    expect(((await resolve(42)) as FakeProvider).secret).toBe('sk-ant-42');
  });

  it('refuses when fallback is on but no platform key is configured', async () => {
    await expect(resolver({ allowPlatformFallback: true })(42)).rejects.toBeInstanceOf(
      MissingInstallationKeyError,
    );
  });

  describe('subscription auth', () => {
    it('routes a subscription installation to the Agent SDK provider when enabled', async () => {
      await writeInstallationAuth(vault, store, 42, 'subscription', 'sk-ant-oat-42');
      const provider = (await resolver({ allowSubscriptionAuth: true })(42)) as FakeProvider;
      expect(provider).toMatchObject({ kind: 'subscription', secret: 'sk-ant-oat-42' });
    });

    it('leaves the API-key path untouched when subscription auth is enabled', async () => {
      await writeInstallationAuth(vault, store, 7, 'api_key', 'sk-ant-7');
      const provider = (await resolver({ allowSubscriptionAuth: true })(7)) as FakeProvider;
      expect(provider).toMatchObject({ kind: 'api_key', secret: 'sk-ant-7' });
    });

    it('keeps two installations on different auth types isolated within one resolver', async () => {
      await writeInstallationAuth(vault, store, 1, 'api_key', 'sk-ant-one');
      await writeInstallationAuth(vault, store, 2, 'subscription', 'sk-ant-oat-two');
      const resolve = resolver({ allowSubscriptionAuth: true });
      expect((await resolve(1)) as FakeProvider).toMatchObject({ kind: 'api_key' });
      expect((await resolve(2)) as FakeProvider).toMatchObject({ kind: 'subscription' });
    });

    it('is off by default — a subscription installation refuses rather than running', async () => {
      await writeInstallationAuth(vault, store, 42, 'subscription', 'sk-ant-oat-42');
      await expect(resolver()(42)).rejects.toBeInstanceOf(MissingInstallationKeyError);
    });

    it('kill-switch: disabling the flag sends subscription installations back to the key path', async () => {
      await writeInstallationAuth(vault, store, 42, 'subscription', 'sk-ant-oat-42');
      const live = resolver({ allowSubscriptionAuth: true });
      expect((await live(42)) as FakeProvider).toMatchObject({ kind: 'subscription' });
      // Same stored row, flag flipped off: refuses, with no data migration in between.
      await expect(resolver({ allowSubscriptionAuth: false })(42)).rejects.toBeInstanceOf(
        MissingInstallationKeyError,
      );
    });

    it('never bills a subscription installation to the operator platform key', async () => {
      await writeInstallationAuth(vault, store, 42, 'subscription', 'sk-ant-oat-42');
      const resolve = resolver({ allowPlatformFallback: true, platformKey: 'sk-ant-platform' });
      await expect(resolve(42)).rejects.toBeInstanceOf(MissingInstallationKeyError);
    });
  });
});
