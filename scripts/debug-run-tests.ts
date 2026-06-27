import 'dotenv/config';
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db/pool.js';
import { PgStore } from '../src/store/pg-store.js';

/**
 * Phase 2 debug trigger: enqueue a `run_tests` job. The running worker picks it
 * up, clones the repo in an E2B sandbox, runs its tests, and records the result.
 *
 * Usage:
 *   npm run debug:run-tests -- <installationId> <owner> <repo> [ref] [issueNumber]
 */
async function main(): Promise<void> {
  const [installationId, owner, repo, ref = 'main', issueNumber = '0'] = process.argv.slice(2);
  if (!installationId || !owner || !repo) {
    console.error(
      'Usage: npm run debug:run-tests -- <installationId> <owner> <repo> [ref] [issueNumber]',
    );
    process.exit(1);
  }

  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const store = new PgStore(pool);

  const job = await store.enqueueJob({
    type: 'run_tests',
    payload: {
      installationId: Number(installationId),
      owner,
      repo,
      ref,
      issueNumber: Number(issueNumber),
    },
  });

  console.log(`Enqueued run_tests job #${job.id} for ${owner}/${repo}@${ref}.`);
  console.log('Watch the running worker; results land in the test_runs table.');
  await pool.end();
}

main().catch((err) => {
  console.error('debug:run-tests failed:', err);
  process.exit(1);
});
