/**
 * GitHub OAuth for the setup page (Phase 12b). Used to prove that a setup-page visitor
 * actually manages the installation they're configuring, before we accept a key. This is
 * the user-to-server (OAuth) side of the GitHub App, distinct from the app's own webhook
 * credentials.
 */

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const USER_INSTALLATIONS_URL = 'https://api.github.com/user/installations';

export interface GitHubOAuthClient {
  /** The URL to send the browser to, to authorize the app and come back with a code. */
  buildAuthorizeUrl(input: { state: string; redirectUri: string }): string;
  /** Exchange the callback `code` for a short-lived user access token. */
  exchangeCode(input: { code: string; redirectUri: string }): Promise<string>;
  /** The ids of the app installations this user can manage/access. */
  listInstallationIds(userToken: string): Promise<number[]>;
}

/** Pure authorize-URL builder — shared by the real client and unit-tested directly. */
export function buildAuthorizeUrl(input: {
  clientId: string;
  state: string;
  redirectUri: string;
}): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    state: input.state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * Real GitHub OAuth client over global `fetch`. Like `AnthropicProvider`/E2B this is the
 * one thin adapter to an external service — verified live, not exercised in CI (the pure
 * `buildAuthorizeUrl` and the setup handlers, tested with a fake client, carry the logic).
 */
export class HttpGitHubOAuthClient implements GitHubOAuthClient {
  constructor(private readonly config: { clientId: string; clientSecret: string }) {}

  buildAuthorizeUrl(input: { state: string; redirectUri: string }): string {
    return buildAuthorizeUrl({ clientId: this.config.clientId, ...input });
  }

  async exchangeCode(input: { code: string; redirectUri: string }): Promise<string> {
    const res = await fetch(ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code: input.code,
        redirect_uri: input.redirectUri,
      }),
    });
    if (!res.ok) throw new Error(`GitHub token exchange failed: ${res.status}`);
    const data = (await res.json()) as { access_token?: string; error?: string };
    if (!data.access_token) throw new Error(`GitHub token exchange returned no token: ${data.error ?? 'unknown'}`);
    return data.access_token;
  }

  async listInstallationIds(userToken: string): Promise<number[]> {
    const res = await fetch(USER_INSTALLATIONS_URL, {
      headers: {
        Authorization: `Bearer ${userToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) throw new Error(`GitHub /user/installations failed: ${res.status}`);
    const data = (await res.json()) as { installations?: { id: number }[] };
    return (data.installations ?? []).map((i) => i.id);
  }
}
