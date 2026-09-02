import 'dotenv/config';
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db/pool.js';
import { PgStore } from '../src/store/pg-store.js';
import { CredentialVault } from '../src/secrets/credential-vault.js';
import { writeInstallationAuth } from '../src/llm/installation-auth.js';
import type { InstallationAuthType } from '../src/store/types.js';

/**
 * Phase 2.1: set an installation's Anthropic credential from the command line. The setup page
 * (Phase 12b) only writes API keys, so this is how a subscription credential gets on file until
 * that surface grows a second path.
 *
 * Get a subscription token by running `claude setup-token` on a machine logged in to the Claude
 * plan you want the runs billed to.
 *
 * Usage:
 *   npm run debug:set-auth -- <installationId> <api_key|subscription> <secret>
 */
const AUTH_TYPES: InstallationAuthType[] = ['api_key', 'subscription'];

async function main(): Promise<void> {
  const [rawId, rawType, secret] = process.argv.slice(2);
  const installationId = Number(rawId);
  if (!Number.isFinite(installationId) || !AUTH_TYPES.includes(rawType as InstallationAuthType) || !secret) {
    console.error('Usage: npm run debug:set-auth -- <installationId> <api_key|subscription> <secret>');
    process.exit(1);
  }

  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const store = new PgStore(pool);
  const vault = new CredentialVault(store, config.masterEncryptionKey);

  await writeInstallationAuth(vault, store, installationId, rawType as InstallationAuthType, secret);
  console.log(`Stored a ${rawType} credential for installation ${installationId}.`);
  if (rawType === 'subscription' && !config.allowSubscriptionAuth) {
    console.warn('Note: ALLOW_SUBSCRIPTION_AUTH is off, so runs will still refuse. Set it to 1.');
  }

  await pool.end();
}

main().catch((err) => {
  console.error('debug:set-auth failed:', err);
  process.exit(1);
});
