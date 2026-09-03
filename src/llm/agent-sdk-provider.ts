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
  num_turns?: number;
  stop_reason?: string | null;
  errors?: unknown;
}

interface AssistantMessage {
  type: 'assistant';
  message?: { content?: Array<{ type?: string; text?: string }> };
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

function isAssistant(m: SDKMessage): m is SDKMessage & AssistantMessage {
  return m.type === 'assistant';
}

/** What the assistant actually said, so a failure can show it rather than just a subtype. */
function assistantText(m: AssistantMessage): string {
  return (m.message?.content ?? [])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');
}

const TRANSCRIPT_TAIL = 2;
const TRANSCRIPT_CHARS = 400;

/**
 * Build the error for a failed call. A spent subscription gets its own type so the worker can
 * refuse terminally; everything else carries enough detail to diagnose without a repro — the
 * subtype, how many turns were burned, and the last thing the model said.
 */
function failureFor(opts: {
  cause?: unknown;
  result?: ResultMessage;
  rateLimit?: RateLimitMessage['rate_limit_info'];
  transcript: string[];
}): Error {
  if (opts.rateLimit?.status === 'rejected') {
    return new SubscriptionRateLimitError(
      opts.rateLimit.resetsAt ? new Date(opts.rateLimit.resetsAt * 1000) : undefined,
    );
  }

  const parts: string[] = [];
  if (opts.result) {
    parts.push(`subtype=${opts.result.subtype}`);
    if (opts.result.num_turns !== undefined) parts.push(`turns=${opts.result.num_turns}`);
    if (opts.result.stop_reason) parts.push(`stop_reason=${opts.result.stop_reason}`);
    if (opts.result.errors !== undefined && opts.result.errors !== null) {
      parts.push(`errors=${JSON.stringify(opts.result.errors).slice(0, 300)}`);
    }
  }
  if (opts.cause) {
    parts.push(`cause=${opts.cause instanceof Error ? opts.cause.message : String(opts.cause)}`);
  }
  const tail = opts.transcript
    .slice(-TRANSCRIPT_TAIL)
    .map((t) => t.slice(0, TRANSCRIPT_CHARS))
    .filter(Boolean);
  if (tail.length) parts.push(`lastSaid=${JSON.stringify(tail)}`);

  return new Error(`Agent SDK call failed (${parts.join(' ') || 'no detail'})`);
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
    const transcript: string[] = [];

    // The SDK yields an error result and *then* throws out of the iterator, so the catch is not
    // optional — without it the error escapes before we can classify it, and a spent
    // subscription is indistinguishable from any other fault.
    try {
      for await (const message of this.runQuery({ prompt, options: this.optionsFor(req) })) {
        if (isRateLimit(message)) lastRateLimit = message.rate_limit_info;
        else if (isResult(message)) result = message;
        else if (isAssistant(message)) transcript.push(assistantText(message));
      }
    } catch (cause) {
      throw failureFor({ cause, result, rateLimit: lastRateLimit, transcript });
    }

    if (!result) throw new Error('Agent SDK produced no result message');
    if (result.subtype !== 'success') {
      throw failureFor({ result, rateLimit: lastRateLimit, transcript });
    }
    // A success with no structured output is still a failure for us: the runner is about to
    // JSON.parse this, and the free-form text would fail there with a far worse message.
    if (req.outputSchema && result.structured_output === undefined) {
      throw failureFor({
        cause: 'run succeeded but produced no structured output',
        result,
        transcript,
      });
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
