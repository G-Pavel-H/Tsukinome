import { vi } from 'vitest';
import type { GitHubClient, PostIssueCommentInput } from '../src/github/client.js';
import type { Logger } from '../src/log.js';

export const silentLog: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** A GitHubClient whose postIssueComment is a spy, with an optional failure mode. */
export function fakeGitHub(opts: { fail?: boolean } = {}): GitHubClient & {
  calls: PostIssueCommentInput[];
  postIssueComment: ReturnType<typeof vi.fn>;
} {
  const calls: PostIssueCommentInput[] = [];
  const postIssueComment = vi.fn(async (input: PostIssueCommentInput) => {
    if (opts.fail) throw new Error('github exploded');
    calls.push(input);
  });
  return { calls, postIssueComment };
}
