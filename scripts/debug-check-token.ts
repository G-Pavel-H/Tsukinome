import 'dotenv/config';
import { probeSubscriptionToken } from '../src/llm/subscription-validator.js';

/**
 * Check a Claude subscription token the same way the connect page does, but print the real
 * error instead of a yes/no. Use this when the page says a token wasn't accepted and you need
 * to know whether that's the token, the plan, or the environment.
 *
 * Usage:
 *   npm run debug:check-token -- <token>
 */
async function main(): Promise<void> {
  const token = process.argv[2];
  if (!token) {
    console.error('Usage: npm run debug:check-token -- <token>');
    process.exit(1);
  }

  console.log(`Token: ${token.length} chars, starts "${token.slice(0, 12)}…"`);
  if (token !== token.trim()) console.warn('⚠️  Token has leading/trailing whitespace.');
  if (/\s/.test(token.trim())) {
    console.warn('⚠️  Token contains a space or newline in the middle — likely a partial paste.');
  }
  if (!token.startsWith('sk-ant-oat')) {
    console.warn('⚠️  Expected a token starting "sk-ant-oat" from `claude setup-token`.');
  }

  try {
    await probeSubscriptionToken(token.trim());
    console.log('✅ Accepted. This token works — the connect page will store it.');
  } catch (err) {
    console.error('❌ Rejected. The underlying error was:');
    console.error(`   ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }
}

main().catch((err) => {
  console.error('debug:check-token failed:', err);
  process.exit(1);
});
