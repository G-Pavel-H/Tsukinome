import type { Probot } from 'probot';

export interface PostIssueCommentInput {
  installationId: number;
  owner: string;
  repo: string;
  issueNumber: number;
  body: string;
}

export interface InstallationTokenInput {
  installationId: number;
  owner: string;
  repo: string;
}

/**
 * The GitHub actions the worker needs. Kept narrow so the worker depends on an
 * interface, not Octokit — tests inject a spy, production injects Probot auth.
 */
export interface GitHubClient {
  postIssueComment(input: PostIssueCommentInput): Promise<void>;
  /**
   * Mint a least-privilege installation token scoped to read the contents of the
   * single target repo — used only as the sandbox's git clone credential.
   */
  getInstallationToken(input: InstallationTokenInput): Promise<string>;
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

    async getInstallationToken(input: InstallationTokenInput): Promise<string> {
      // App-level (JWT) Octokit, then mint a token scoped to read this one repo.
      const appOctokit = await probot.auth();
      const { data } = await appOctokit.rest.apps.createInstallationAccessToken({
        installation_id: input.installationId,
        repositories: [input.repo],
        permissions: { contents: 'read' },
      });
      return data.token;
    },
  };
}
