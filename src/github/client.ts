import type { Probot } from 'probot';

export interface PostIssueCommentInput {
  installationId: number;
  owner: string;
  repo: string;
  issueNumber: number;
  body: string;
}

/**
 * The GitHub actions the worker needs. Kept narrow so the worker depends on an
 * interface, not Octokit — tests inject a spy, production injects Probot auth.
 */
export interface GitHubClient {
  postIssueComment(input: PostIssueCommentInput): Promise<void>;
}

/**
 * Production GitHubClient. `probot.auth(installationId)` mints the App JWT and
 * exchanges it for a least-privilege installation token, returning an
 * authenticated Octokit — so the worker can act out-of-band from the webhook.
 */
export function createProbotGitHubClient(probot: Probot): GitHubClient {
  return {
    async postIssueComment(input: PostIssueCommentInput): Promise<void> {
      const octokit = await probot.auth(input.installationId);
      await octokit.rest.issues.createComment({
        owner: input.owner,
        repo: input.repo,
        issue_number: input.issueNumber,
        body: input.body,
      });
    },
  };
}
