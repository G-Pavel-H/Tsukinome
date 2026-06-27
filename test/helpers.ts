import { vi } from 'vitest';
import type { GitHubClient, PostIssueCommentInput } from '../src/github/client.js';
import type { Logger } from '../src/log.js';

export const silentLog: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** A GitHubClient whose methods are spies, with an optional failure mode. */
export function fakeGitHub(opts: { fail?: boolean; token?: string } = {}): GitHubClient & {
  calls: PostIssueCommentInput[];
  postIssueComment: ReturnType<typeof vi.fn>;
  getInstallationToken: ReturnType<typeof vi.fn>;
} {
  const calls: PostIssueCommentInput[] = [];
  const postIssueComment = vi.fn(async (input: PostIssueCommentInput) => {
    if (opts.fail) throw new Error('github exploded');
    calls.push(input);
  });
  const getInstallationToken = vi.fn(async () => opts.token ?? 'ghs_faketoken');
  return { calls, postIssueComment, getInstallationToken };
}
