import { query, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { LlmProvider, LlmRequest, LlmResponse, Usage } from './types.js';

/** The Agent SDK entry point, injectable so tests never spawn the bundled Claude Code binary. */
export type AgentQuery = (args: { prompt: string; options: Options }) => AsyncIterable<SDKMessage>;

/**
 * Thrown when an installation's Claude subscription has no capacity left. This is the
 * subscription-side parallel of `BudgetExhaustedError`: not a bug, not worth retrying inside a
 * backoff window, and something only time (or a plan upgrade) fixes — so the worker refuses
 * terminally and says when the limit resets.
 */
export class SubscriptionRateLimitError extends Error {
  constructor(readonly resetsAt?: Date) {
    super(
      resetsAt
        ? `Claude subscription rate limit reached; resets at ${resetsAt.toISOString()}`
        : 'Claude subscription rate limit reached',
    );
    this.name = 'SubscriptionRateLimitError';
  }
}

/** Turns allowed per call: one to answer, the rest for the SDK's schema-conformance retries. */
const MAX_TURNS = 4;

const EMPTY_USAGE: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
};

/**
 * Sum the SDK's per-model token totals into our `Usage`. `modelUsage` is the field the SDK
 * documents for accounting (`usage` covers the main loop only), and its field names already
 * match ours. We issue one single-turn call per query, so in practice this folds one entry.
 */
function sumUsage(modelUsage: Record<string, ModelTokens> | undefined): Usage {
  return Object.values(modelUsage ?? {}).reduce<Usage>(
    (acc, m) => ({
      inputTokens: acc.inputTokens + (m.inputTokens ?? 0),
      outputTokens: acc.outputTokens + (m.outputTokens ?? 0),
      cacheCreationInputTokens: acc.cacheCreationInputTokens + (m.cacheCreationInputTokens ?? 0),
      cacheReadInputTokens: acc.cacheReadInputTokens + (m.cacheReadInputTokens ?? 0),
    }),
    EMPTY_USAGE,
  );
}

/** The slice of the SDK's `ModelUsage` we read. */
interface ModelTokens {
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  canonicalModel?: string;
}

interface ResultMessage {
  type: 'result';
  subtype: string;
  result?: string;
  structured_output?: unknown;
  modelUsage?: Record<string, ModelTokens>;
}

interface RateLimitMessage {
  type: 'rate_limit_event';
  rate_limit_info?: { status?: string; resetsAt?: number };
}

function isResult(m: SDKMessage): m is SDKMessage & ResultMessage {
  return m.type === 'result';
}

function isRateLimit(m: SDKMessage): m is SDKMessage & RateLimitMessage {
  return m.type === 'rate_limit_event';
}

/**
 * `LlmProvider` backed by the Claude Agent SDK, authenticated with an installation's Claude
 * subscription rather than an API key (Phase 2.1). It sits behind the same seam as
 * `AnthropicProvider`, so the gateway, budget, cost logging and agent runner are unchanged.
 *
 * Deliberately narrow: every Tsukinome role is a single-shot, tool-free call that returns
 * schema-constrained JSON, so this drives the harness as a one-turn text-in/JSON-out function.
 * Request shapes it cannot represent faithfully are rejected rather than silently degraded.
 */
export class AgentSdkProvider implements LlmProvider {
  constructor(
    private readonly oauthToken: string,
    private readonly runQuery: AgentQuery = query as AgentQuery,
  ) {}

  async createMessage(req: LlmRequest): Promise<LlmResponse> {
    const prompt = singleUserPrompt(req);

    let lastRateLimit: RateLimitMessage['rate_limit_info'];
    let result: ResultMessage | undefined;

    for await (const message of this.runQuery({ prompt, options: this.optionsFor(req) })) {
      if (isRateLimit(message)) lastRateLimit = message.rate_limit_info;
      else if (isResult(message)) result = message;
    }

    if (!result) throw new Error('Agent SDK produced no result message');
    if (result.subtype !== 'success') {
      if (lastRateLimit?.status === 'rejected') throw rateLimitError(lastRateLimit.resetsAt);
      throw new Error(`Agent SDK call failed: ${result.subtype}`);
    }

    const usage = sumUsage(result.modelUsage);
    const model =
      Object.values(result.modelUsage ?? {})[0]?.canonicalModel ??
      Object.keys(result.modelUsage ?? {})[0] ??
      req.model;

    // The agent runner parses the response text as JSON and validates it against the role's
    // schema, so hand structured output back the same way the Messages API would.
    const text =
      result.structured_output !== undefined
        ? JSON.stringify(result.structured_output)
        : (result.result ?? '');

    return { stopReason: 'end_turn', content: [{ type: 'text', text }], usage, model };
  }

  private optionsFor(req: LlmRequest): Options {
    return {
      model: req.model,
      systemPrompt: { type: 'custom', prompt: req.system.map((b) => b.text).join('\n\n') },
      ...(req.outputSchema ? { outputFormat: { type: 'json_schema', schema: req.outputSchema } } : {}),
      // Sealed shut. Issue bodies and comments reach this prompt as data; a harness holding Bash
      // or Edit would turn that data into commands, and repo settings could rewrite the role's
      // instructions. No tools, no filesystem config — that, not the turn count, is the safety
      // invariant: with an empty tool list there is nothing extra turns could reach.
      allowedTools: [],
      settingSources: [],
      permissionMode: 'default',
      // The SDK re-prompts itself when structured output doesn't satisfy the schema, and each
      // attempt costs a turn. A cap of 1 left no room for that and failed the roles with the
      // largest schemas (architect, test-author) outright. Bounded, not unbounded — the run
      // budget in the gateway is the real cost ceiling.
      maxTurns: MAX_TURNS,
      // Only the installation's own credential — never the operator's ambient environment.
      env: { CLAUDE_CODE_OAUTH_TOKEN: this.oauthToken },
    } as Options;
  }
}

function rateLimitError(resetsAtEpochSeconds?: number): SubscriptionRateLimitError {
  return new SubscriptionRateLimitError(
    resetsAtEpochSeconds ? new Date(resetsAtEpochSeconds * 1000) : undefined,
  );
}

/**
 * Flatten the request to the one shape the harness takes. Every production role sends exactly
 * one user turn with no tools; anything else would have to be dropped or faked, so refuse loudly.
 */
function singleUserPrompt(req: LlmRequest): string {
  if (req.tools?.length) {
    throw new Error('AgentSdkProvider does not support tool-use roles');
  }
  const [message, ...rest] = req.messages;
  if (!message || rest.length > 0 || typeof message.content !== 'string') {
    throw new Error('AgentSdkProvider requires a single user message with string content');
  }
  return message.content;
}
