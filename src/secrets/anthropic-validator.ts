import Anthropic from '@anthropic-ai/sdk';

/**
 * Validate a pasted Anthropic API key before storing it (Phase 12b) — catch typos at the
 * form, not mid-run. Returns true if the key authenticates, false if it's rejected. Kept
 * behind a function type so the setup handlers unit-test with a fake and never hit the API.
 */
export type AnthropicKeyValidator = (apiKey: string) => Promise<boolean>;

/**
 * Real validator: one cheap, token-free `models.list()` call. A 401 (bad key) → false;
 * other/transient errors propagate so the page can say "couldn't validate, try again"
 * rather than silently rejecting a good key. Verified live, not in CI.
 */
export const anthropicKeyValidator: AnthropicKeyValidator = async (apiKey) => {
  const client = new Anthropic({ apiKey });
  try {
    await client.models.list({ limit: 1 });
    return true;
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return false;
    throw err;
  }
};
