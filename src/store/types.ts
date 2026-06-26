/**
 * Run state machine. The full pipeline is enumerated here so transitions are
 * named from the start; Phase 1 only exercises `received` -> `acknowledged`.
 * Later phases own the remaining states.
 */
export const RunState = {
  Received: 'received',
  Acknowledged: 'acknowledged',
  Triaging: 'triaging',
  Specifying: 'specifying',
  AwaitingClarification: 'awaiting_clarification',
  Planning: 'planning',
  AwaitingPlanApproval: 'awaiting_plan_approval',
  Implementing: 'implementing',
  Reviewing: 'reviewing',
  Integrating: 'integrating',
  AwaitingPrReview: 'awaiting_pr_review',
  Done: 'done',
  Failed: 'failed',
  Aborted: 'aborted',
} as const;

// Value + type share a name (declaration merging) so callers use `RunState` for both.
// eslint-disable-next-line no-redeclare
export type RunState = (typeof RunState)[keyof typeof RunState];

export type JobStatus = 'queued' | 'in_progress' | 'done' | 'failed';

/** Phase 1 has a single job type; this widens as the pipeline grows. */
export type JobType = 'issue_opened';

/** Payload for an `issue_opened` job — enough for the worker to act out-of-band. */
export interface IssueOpenedPayload {
  installationId: number;
  owner: string;
  repo: string;
  issueNumber: number;
  deliveryId: string;
}

export type JobPayload = IssueOpenedPayload;

export interface Job {
  id: number;
  type: JobType;
  payload: JobPayload;
  status: JobStatus;
  attempts: number;
}

export interface Run {
  id: number;
  installationId: number;
  owner: string;
  repo: string;
  issueNumber: number;
  state: RunState;
  context: Record<string, unknown>;
}

/** Identifies the one run that belongs to a given issue. */
export interface RunKey {
  installationId: number;
  owner: string;
  repo: string;
  issueNumber: number;
}

export interface FindOrCreateRunResult {
  run: Run;
  /** True when this call inserted the run; false when it already existed. */
  created: boolean;
}

/**
 * Persistence boundary for the queue, runs, and webhook dedupe. Two
 * implementations: PgStore (production) and InMemoryStore (tests / no-DB dev).
 */
export interface Store {
  enqueueJob(input: { type: JobType; payload: JobPayload }): Promise<Job>;
  /** Atomically claim the next queued job, marking it in_progress. */
  claimNextJob(): Promise<Job | null>;
  markJobDone(jobId: number): Promise<void>;
  markJobFailed(jobId: number, error: string): Promise<void>;
  findOrCreateRun(key: RunKey, initialState: RunState): Promise<FindOrCreateRunResult>;
  updateRunState(runId: number, state: RunState): Promise<void>;
  getRun(key: RunKey): Promise<Run | null>;
  /** Returns true if the delivery id was newly recorded, false if already seen. */
  tryMarkEventProcessed(deliveryId: string): Promise<boolean>;
}
