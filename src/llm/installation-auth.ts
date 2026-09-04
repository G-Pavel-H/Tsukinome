import type { CredentialVault } from '../secrets/credential-vault.js';
import type { InstallationAuthType, Store } from '../store/types.js';

/** The two halves of an installation's Anthropic credential: the secret and what kind it is. */
export interface InstallationAuth {
  authType: InstallationAuthType;
  /** An API key (`sk-ant-…`) or a Claude subscription OAuth token, per `authType`. */
  secret: string;
}

/** The store operations this module needs — narrow so tests can pass an in-memory store. */
type AuthTypeStore = Pick<Store, 'getInstallationAuthType' | 'setInstallationAuthType'>;

/**
 * Read an installation's credential (Phase 2.1). The secret stays inside the vault's
 * encrypt-at-rest boundary; the auth type is plain metadata alongside it. Credentials written
 * before the discriminator existed — and those the Phase 12b setup page still writes through the
 * vault alone — read back as `api_key`, so the pay-as-you-go path is the default in every sense.
 */
export async function readInstallationAuth(
  vault: CredentialVault,
  store: AuthTypeStore,
  installationId: number,
): Promise<InstallationAuth | null> {
  const secret = await vault.getAnthropicKey(installationId);
  if (!secret) return null;
  const authType = (await store.getInstallationAuthType(installationId)) ?? 'api_key';
  return { authType, secret };
}

/**
 * Store an installation's credential and label it. The secret is written first so the row exists
 * for the auth type to attach to — the two are one logical write, and this is the only place that
 * ordering is expressed.
 */
export async function writeInstallationAuth(
  vault: CredentialVault,
  store: AuthTypeStore,
  installationId: number,
  authType: InstallationAuthType,
  secret: string,
): Promise<void> {
  await vault.setAnthropicKey(installationId, secret);
  const labelled = await store.setInstallationAuthType(installationId, authType);
  if (!labelled) {
    throw new Error(`Stored a credential for installation ${installationId} but could not label it`);
  }
}
