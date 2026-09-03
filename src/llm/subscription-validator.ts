import { AgentSdkProvider } from './agent-sdk-provider.js';

/** Checks that a Claude subscription token actually works, before we store it. */
export type SubscriptionTokenValidator = (token: string) => Promise<boolean>;

/**
 * Validate by making the smallest possible real call through the Agent SDK. A subscription
 * token can't be checked against the Messages API — it isn't an API key — so the only honest
 * test is the path the runs themselves take. Costs a handful of tokens against the user's plan,
 * which is the price of not storing a credential that fails on their first issue.
 */
export const subscriptionTokenValidator: SubscriptionTokenValidator = async (token) => {
  await probeSubscriptionToken(token);
  return true;
};

/**
 * The same check, but it throws the underlying error instead of collapsing it to a boolean.
 * A rejected token and a broken environment are very different problems, and the form can only
 * say "that didn't work" — so callers that can surface detail (the server log, `debug:check-token`)
 * use this and report what actually came back.
 */
export async function probeSubscriptionToken(token: string): Promise<void> {
  const provider = new AgentSdkProvider(token);
  await provider.createMessage({
    model: 'claude-haiku-4-5',
    system: [{ text: 'Reply with the single word: ok' }],
    messages: [{ role: 'user', content: 'ok' }],
    maxTokens: 16,
  });
}
