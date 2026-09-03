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

/**
 * Build a provider whose SDK calls are recorded and answered from `messages`.
 *
 * The real SDK yields an error result and *then* throws out of the iterator, so the fake does
 * too — an earlier version of this fake only yielded, which hid a bug where the throw escaped
 * before the provider could classify it.
 */
function providerWith(messages: unknown[], opts: { throwAfter?: boolean } = {}) {
  const calls: Array<{ prompt: string; options: Record<string, unknown> }> = [];
  const runQuery = ((args: { prompt: string; options: Record<string, unknown> }) => {
    calls.push(args);
    return (async function* () {
      for (const m of messages) yield m;
      if (opts.throwAfter) {
        throw new Error('Claude Code returned an error result: something went wrong');
      }
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
    const { provider, calls } = providerWith([successResult({ structured_output: {} })]);
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

  it('runs the harness sealed shut: no tools, no filesystem settings', async () => {
    // The safety invariant is load-bearing here — issue text reaches this prompt as data, and
    // an agent holding Bash or Edit would turn that data into commands. Turn count is not part
    // of it: with an empty tool list there is nothing extra turns could reach.
    const { provider, calls } = providerWith([successResult()]);
    await provider.createMessage(baseRequest);
    // `tools` is the option that removes the built-in toolset; `allowedTools` only controls
    // auto-approval, so asserting on it alone let a fully-armed harness pass this test.
    expect(calls[0].options.tools).toEqual([]);
    expect(calls[0].options.allowedTools).toEqual([]);
    expect(calls[0].options.settingSources).toEqual([]);
    expect(calls[0].options.permissionMode).toBe('default');
  });

  it('leaves the SDK room to retry structured output, but keeps it bounded', async () => {
    // A cap of 1 gave the SDK no turn in which to re-prompt after a schema mismatch, which failed
    // the roles with the largest schemas outright ("Reached maximum number of turns (1)").
    const { provider, calls } = providerWith([successResult()]);
    await provider.createMessage(baseRequest);
    const maxTurns = calls[0].options.maxTurns as number;
    expect(maxTurns).toBeGreaterThan(1);
    expect(maxTurns).toBeLessThanOrEqual(8);
  });

  it('passes the installation token through, and clears any credential that would outrank it', async () => {
    // `env` replaces rather than merges, so the inherited environment has to be forwarded — but
    // an operator API key surviving in it would silently bill the operator, not the installation.
    process.env.ANTHROPIC_API_KEY = 'sk-ant-operator-key';
    try {
      const { provider, calls } = providerWith([successResult()]);
      await provider.createMessage(baseRequest);
      const env = calls[0].options.env as Record<string, string | undefined>;
      expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('sk-ant-oat-test');
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
      expect(env.PATH).toBe(process.env.PATH); // the binary still needs its environment
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it('raises SubscriptionRateLimitError when the plan rejects the call', async () => {
    const resetsAt = Math.floor(Date.now() / 1000) + 3600;
    const { provider } = providerWith(
      [
        { type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt } },
        { type: 'result', subtype: 'error_during_execution', modelUsage: {} },
      ],
      { throwAfter: true },
    );
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
    const { provider } = providerWith(
      [{ type: 'result', subtype: 'error_max_structured_output_retries', modelUsage: {} }],
      { throwAfter: true },
    );
    const err = await provider.createMessage(baseRequest).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(SubscriptionRateLimitError);
    expect((err as Error).message).toContain('error_max_structured_output_retries');
  });

  it('reports why a call failed — subtype, turns burned, and what the model last said', async () => {
    // Without this the log said only "Reached maximum number of turns", which named the symptom
    // and hid every input needed to diagnose it.
    const { provider } = providerWith(
      [
        { type: 'assistant', message: { content: [{ type: 'text', text: 'Let me plan that.' }] } },
        {
          type: 'result',
          subtype: 'error_max_turns',
          num_turns: 4,
          stop_reason: 'max_turns',
          errors: [{ code: 'schema_mismatch' }],
          modelUsage: {},
        },
      ],
      { throwAfter: true },
    );
    const err = (await provider.createMessage(baseRequest).catch((e: unknown) => e)) as Error;
    expect(err.message).toContain('error_max_turns');
    expect(err.message).toContain('turns=4');
    expect(err.message).toContain('schema_mismatch');
    expect(err.message).toContain('Let me plan that.');
  });

  it('still recognises an exhausted plan when the SDK throws on its way out', async () => {
    const { provider } = providerWith(
      [
        { type: 'rate_limit_event', rate_limit_info: { status: 'rejected' } },
        { type: 'result', subtype: 'error_during_execution', modelUsage: {} },
      ],
      { throwAfter: true },
    );
    await expect(provider.createMessage(baseRequest)).rejects.toBeInstanceOf(
      SubscriptionRateLimitError,
    );
  });

  it('treats a success that produced no structured output as a failure', async () => {
    // The runner is about to JSON.parse this; free-form prose would fail there far less legibly.
    const { provider } = providerWith([successResult({ result: 'here is my plan, in prose' })]);
    const err = (await provider
      .createMessage({ ...baseRequest, outputSchema: { type: 'object' } })
      .catch((e: unknown) => e)) as Error;
    expect(err.message).toMatch(/no structured output/i);
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
