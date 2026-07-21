import type { Logger } from '../log.js';
import type { CredentialVault } from '../secrets/credential-vault.js';
import type { AnthropicKeyValidator } from '../secrets/anthropic-validator.js';
import type { GitHubOAuthClient } from '../github/oauth.js';
import type { SessionStore } from './session-store.js';
import { renderErrorPage, renderKeyForm, renderSuccessPage } from './setup-pages.js';

/** The name of the httpOnly cookie carrying the setup session id. */
export const SETUP_COOKIE = 'tsukinome_setup';
const SESSION_MAX_AGE_SEC = 10 * 60;

export interface SetupDeps {
  oauth: GitHubOAuthClient;
  validateKey: AnthropicKeyValidator;
  vault: CredentialVault;
  sessions: SessionStore;
  config: { clientId: string; clientSecret: string; baseUrl: string };
  log: Logger;
}

/** What a handler wants the HTTP layer to send back. Keeps handlers free of req/res. */
export type SetupResult =
  | { kind: 'redirect'; location: string }
  | {
      kind: 'html';
      status: number;
      body: string;
      cookie?: { name: string; value: string; maxAgeSec: number };
    };

function html(status: number, body: string): SetupResult {
  return { kind: 'html', status, body };
}

function callbackRedirectUri(baseUrl: string): string {
  return `${baseUrl}/setup/callback`;
}

/**
 * `GET /setup?installation_id=X` — the App's Setup URL landing. We always route through the
 * OAuth authorize→callback dance (uniform whether or not user-auth-during-install is on), so
 * ownership is proven before any key form is shown.
 */
export async function handleSetupStart(
  input: { installationId: number | null },
  deps: SetupDeps,
): Promise<SetupResult> {
  if (input.installationId === null || !Number.isFinite(input.installationId)) {
    return html(400, renderErrorPage('Missing installation', 'This link is missing an installation id. Re-open it from the GitHub App install/settings page.'));
  }
  const state = deps.sessions.createState(input.installationId);
  const location = deps.oauth.buildAuthorizeUrl({
    state,
    redirectUri: callbackRedirectUri(deps.config.baseUrl),
  });
  return { kind: 'redirect', location };
}

/**
 * `GET /setup/callback?code=…&state=…` — back from GitHub. Exchange the code, list the
 * user's installations, and only proceed for the installation they actually manage.
 */
export async function handleCallback(
  input: { code: string | null; state: string | null },
  deps: SetupDeps,
): Promise<SetupResult> {
  if (!input.code || !input.state) {
    return html(400, renderErrorPage('Invalid request', 'The GitHub callback was missing required parameters.'));
  }
  const installationId = deps.sessions.consumeState(input.state);
  if (installationId === null) {
    return html(400, renderErrorPage('Link expired', 'This setup link has expired or was already used. Start again from the GitHub App page.'));
  }

  let verifiedInstallationIds: number[];
  try {
    const userToken = await deps.oauth.exchangeCode({
      code: input.code,
      redirectUri: callbackRedirectUri(deps.config.baseUrl),
    });
    verifiedInstallationIds = await deps.oauth.listInstallationIds(userToken);
  } catch (err) {
    deps.log.error({ err: err instanceof Error ? err.message : String(err) }, 'OAuth exchange failed');
    return html(502, renderErrorPage('GitHub sign-in failed', 'Could not verify your GitHub account. Please try again.'));
  }

  if (!verifiedInstallationIds.includes(installationId)) {
    deps.log.warn({ installationId }, 'Setup rejected: visitor does not manage this installation');
    return html(403, renderErrorPage('Not authorized', 'Your GitHub account does not manage this Tsukinome installation, so you cannot set its key.'));
  }

  const sessionId = deps.sessions.createSession({ verifiedInstallationIds });
  return {
    kind: 'html',
    status: 200,
    body: renderKeyForm(installationId),
    cookie: { name: SETUP_COOKIE, value: sessionId, maxAgeSec: SESSION_MAX_AGE_SEC },
  };
}

/**
 * `POST /setup/key` — store (or rotate) the key. Re-checks ownership against the session
 * (never a hidden field alone), validates the key with Anthropic, then encrypts + stores.
 */
export async function handleKeySubmit(
  input: { sessionId: string | null; installationId: number | null; apiKey: string | null },
  deps: SetupDeps,
): Promise<SetupResult> {
  const session = input.sessionId ? deps.sessions.getSession(input.sessionId) : null;
  if (!session) {
    return html(401, renderErrorPage('Session expired', 'Your setup session has expired. Start again from the GitHub App page.'));
  }
  if (
    input.installationId === null ||
    !session.verifiedInstallationIds.includes(input.installationId)
  ) {
    deps.log.warn({ installationId: input.installationId }, 'Key submit rejected: not a verified installation for this session');
    return html(403, renderErrorPage('Not authorized', 'You are not authorized to set the key for this installation.'));
  }

  const apiKey = (input.apiKey ?? '').trim();
  if (!apiKey) {
    return html(400, renderKeyForm(input.installationId, 'Please paste your Anthropic API key.'));
  }

  let valid: boolean;
  try {
    valid = await deps.validateKey(apiKey);
  } catch (err) {
    deps.log.error({ err: err instanceof Error ? err.message : String(err) }, 'Anthropic key validation errored');
    return html(502, renderKeyForm(input.installationId, "Couldn't reach Anthropic to validate the key. Please try again."));
  }
  if (!valid) {
    return html(400, renderKeyForm(input.installationId, 'Anthropic rejected that key. Check it and try again.'));
  }

  await deps.vault.setAnthropicKey(input.installationId, apiKey);
  deps.log.info({ installationId: input.installationId }, 'Stored Anthropic key for installation');
  return html(200, renderSuccessPage(input.installationId));
}
