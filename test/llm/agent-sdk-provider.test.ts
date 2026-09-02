import { describe, it, expect } from 'vitest';
import {
  AgentSdkProvider,
  SubscriptionRateLimitError,
  type AgentQuery,
} from '../../src/llm/agent-sdk-provider.js';
import type { LlmRequest } from '../../src/llm/types.js';

/** A minimal successful `result` message, shaped like the Agent SDK's. */
function successResult(over: Record<string, unknown> = {}) {
  return {
    type: 'result',
    subtype: 'success',
    result: 'done',
    modelUsage: {
      'claude-opus-4-8': {
        inputTokens: 100,
        outputTokens: 20,
        cacheReadInputTokens: 7,
        cacheCreationInputTokens: 3,
        canonicalModel: 'claude-opus-4-8',
      },
    },
    ...over,
  };
}

/** Build a provider whose SDK calls are recorded and answered from `messages`. */
function providerWith(messages: unknown[]) {
  const calls: Array<{ prompt: string; options: Record<string, unknown> }> = [];
  const runQuery = ((args: { prompt: string; options: Record<string, unknown> }) => {
    calls.push(args);
    return (async function* () {
      for (const m of messages) yield m;
    })();
  }) as unknown as AgentQuery;
  return { provider: new AgentSdkProvider('sk-ant-oat-test', runQuery), calls };
}

const baseRequest: LlmRequest = {
  model: 'claude-opus-4-8',
  system: [{ text: 'Constitution.' }, { text: 'Role instructions.', cacheControl: 'ephemeral' }],
  messages: [{ role: 'user', content: 'Draft a spec.' }],
  maxTokens: 4096,
};

describe('AgentSdkProvider', () => {
  it('returns the structured output as JSON text so the agent runner can parse it', async () => {
    const { provider } = providerWith([
      successResult({ structured_output: { classification: 'feature' } }),
    ]);
    const res = await provider.createMessage({
      ...baseRequest,
      outputSchema: { type: 'object', properties: { classification: { type: 'string' } } },
    });
    expect(res.content).toEqual([{ type: 'text', text: '{"classification":"feature"}' }]);
    expect(res.stopReason).toBe('end_turn');
  });

  it('returns the assistant text when the role declares no schema', async () => {
    const { provider } = providerWith([successResult({ result: 'pong' })]);
    const res = await provider.createMessage(baseRequest);
    expect(res.content).toEqual([{ type: 'text', text: 'pong' }]);
  });

  it('maps per-model token usage so cost logging and the budget keep working', async () => {
    const { provider } = providerWith([successResult()]);
    const res = await provider.createMessage(baseRequest);
    expect(res.usage).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      cacheReadInputTokens: 7,
      cacheCreationInputTokens: 3,
    });
    expect(res.model).toBe('claude-opus-4-8');
  });

  it('passes the requested model, the joined system prompt, and the schema to the SDK', async () => {
    const { provider, calls } = providerWith([successResult()]);
    const schema = { type: 'object', properties: {} };
    await provider.createMessage({ ...baseRequest, outputSchema: schema });
    expect(calls).toHaveLength(1);
    expect(calls[0].prompt).toBe('Draft a spec.');
    expect(calls[0].options.model).toBe('claude-opus-4-8');
    expect(calls[0].options.systemPrompt).toEqual({
      type: 'custom',
      prompt: 'Constitution.\n\nRole instructions.',
    });
    expect(calls[0].options.outputFormat).toEqual({ type: 'json_schema', schema });
  });

  it('runs the harness sealed shut: no tools, no filesystem settings, one turn', async () => {
    // The safety invariant is load-bearing here — issue text reaches this prompt as data, and
    // an agent holding Bash or Edit would turn that data into commands.
    const { provider, calls } = providerWith([successResult()]);
    await provider.createMessage(baseRequest);
    expect(calls[0].options.allowedTools).toEqual([]);
    expect(calls[0].options.settingSources).toEqual([]);
    expect(calls[0].options.maxTurns).toBe(1);
    expect(calls[0].options.permissionMode).toBe('default');
  });

  it('authenticates with the installation token without leaking the ambient environment', async () => {
    const { provider, calls } = providerWith([successResult()]);
    await provider.createMessage(baseRequest);
    const env = calls[0].options.env as Record<string, string | undefined>;
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('sk-ant-oat-test');
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('raises SubscriptionRateLimitError when the plan rejects the call', async () => {
    const resetsAt = Math.floor(Date.now() / 1000) + 3600;
    const { provider } = providerWith([
      { type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt } },
      { type: 'result', subtype: 'error_during_execution', modelUsage: {} },
    ]);
    const err = await provider.createMessage(baseRequest).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SubscriptionRateLimitError);
    expect((err as SubscriptionRateLimitError).resetsAt?.getTime()).toBe(resetsAt * 1000);
  });

  it('does not mistake an allowed rate-limit warning for exhaustion', async () => {
    const { provider } = providerWith([
      { type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning' } },
      successResult(),
    ]);
    await expect(provider.createMessage(baseRequest)).resolves.toMatchObject({
      stopReason: 'end_turn',
    });
  });

  it('surfaces other failures as ordinary errors so the job retries', async () => {
    const { provider } = providerWith([
      { type: 'result', subtype: 'error_max_structured_output_retries', modelUsage: {} },
    ]);
    const err = await provider.createMessage(baseRequest).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(SubscriptionRateLimitError);
    expect((err as Error).message).toContain('error_max_structured_output_retries');
  });

  it('refuses request shapes it cannot faithfully represent, rather than silently dropping them', async () => {
    const { provider } = providerWith([successResult()]);
    await expect(
      provider.createMessage({
        ...baseRequest,
        messages: [
          { role: 'user', content: 'first' },
          { role: 'assistant', content: 'second' },
        ],
      }),
    ).rejects.toThrow(/single user message/i);
    await expect(
      provider.createMessage({
        ...baseRequest,
        tools: [{ name: 'ping', description: 'p', inputSchema: {} }],
      }),
    ).rejects.toThrow(/tool/i);
  });
});
