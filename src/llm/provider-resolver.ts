import type { LlmProvider } from './types.js';
import type { CredentialVault } from '../secrets/credential-vault.js';
import type { Store } from '../store/types.js';
import { readInstallationAuth } from './installation-auth.js';

/**
 * Resolves the `LlmProvider` to use for a given installation's run (Phase 12). This is
 * where per-installation billing happens: each run's model calls go to a provider built
 * from *that installation's* credential. Injected into the `LlmGateway`, which calls it with
 * the run's `installationId` before every model call.
 */
export type ProviderResolver = (installationId: number) => Promise<LlmProvider>;

/** Build an `LlmProvider` from a plaintext secret. Injectable so tests avoid the real SDKs. */
export type ProviderFactory = (secret: string) => LlmProvider;

/**
 * Thrown when an installation has no usable credential and no operator fallback is allowed.
 * Propagates unchanged through the gateway (never caught there) so it refuses *before*
 * any model call — the worker turns it into a graceful "set up your key" refusal.
 */
export class MissingInstallationKeyError extends Error {
  constructor(readonly installationId: number) {
    super(`No usable Anthropic credential on file for installation ${installationId}`);
    this.name = 'MissingInstallationKeyError';
  }
}

export interface ProviderResolverOptions {
  vault: CredentialVault;
  store: Pick<Store, 'getInstallationAuthType' | 'setInstallationAuthType'>;
  /** Build a provider from a plaintext API key (default in prod: `new AnthropicProvider(key)`). */
  factory: ProviderFactory;
  /** Build a provider from a subscription OAuth token (`new AgentSdkProvider(token)`). */
  subscriptionFactory?: ProviderFactory;
  /**
   * Phase 2.1 feature flag. Off by default: subscription-backed runs need Anthropic's approval
   * before being offered to third-party installations, and this is the kill-switch. Flipping it
   * off sends every subscription installation back to the API-key path with no data migration.
   */
  allowSubscriptionAuth?: boolean;
  /** Operator fallback for self-host / dogfooding — off unless explicitly enabled. */
  allowPlatformFallback?: boolean;
  /** The operator's platform key, used only when `allowPlatformFallback` is true. */
  platformKey?: string;
}

/**
 * Resolution order: the installation's own stored credential (routed by its auth type) → (if
 * fallback is enabled) the operator platform key → otherwise refuse with
 * `MissingInstallationKeyError`. Resolving per call (not once at startup) means a rotated
 * credential takes effect on the next call and two installations never share a provider.
 *
 * A subscription credential that the flag disallows is treated as no credential at all — never
 * as licence to bill the operator's platform key instead.
 */
export function buildProviderResolver(opts: ProviderResolverOptions): ProviderResolver {
  return async (installationId: number): Promise<LlmProvider> => {
    const auth = await readInstallationAuth(opts.vault, opts.store, installationId);

    if (auth?.authType === 'api_key') return opts.factory(auth.secret);
    if (auth?.authType === 'subscription') {
      if (opts.allowSubscriptionAuth && opts.subscriptionFactory) {
        return opts.subscriptionFactory(auth.secret);
      }
      throw new MissingInstallationKeyError(installationId);
    }

    if (opts.allowPlatformFallback && opts.platformKey) return opts.factory(opts.platformKey);
    throw new MissingInstallationKeyError(installationId);
  };
}

/** Wrap a fixed provider as a resolver — used by tests and by the gateway's compat path. */
export function constantProviderResolver(provider: LlmProvider): ProviderResolver {
  return async () => provider;
}
