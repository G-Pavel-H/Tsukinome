import type { Logger } from '../log.js';
import type { CredentialVault } from '../secrets/credential-vault.js';
import type { AnthropicKeyValidator } from '../secrets/anthropic-validator.js';
import type { GitHubOAuthClient } from '../github/oauth.js';
import type { SessionStore } from './session-store.js';
import type { SubscriptionTokenValidator } from '../llm/subscription-validator.js';
import { writeInstallationAuth } from '../llm/installation-auth.js';
import type { InstallationAuthType, Store } from '../store/types.js';
import { renderCredentialForm, renderErrorPage, renderSuccessPage } from './setup-pages.js';

/** The name of the httpOnly cookie carrying the setup session id. */
export const SETUP_COOKIE = 'tsukinome_setup';
const SESSION_MAX_AGE_SEC = 10 * 60;

export interface SetupDeps {
  oauth: GitHubOAuthClient;
  validateKey: AnthropicKeyValidator;
  validateSubscriptionToken: SubscriptionTokenValidator;
  /** Mirrors `ALLOW_SUBSCRIPTION_AUTH`. When off, the subscription option is refused here too —
   *  storing a credential every run would then reject is worse than saying so up front. */
  allowSubscriptionAuth: boolean;
  vault: CredentialVault;
  store: Pick<Store, 'getInstallationAuthType' | 'setInstallationAuthType'>;
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
    body: renderCredentialForm(installationId),
    cookie: { name: SETUP_COOKIE, value: sessionId, maxAgeSec: SESSION_MAX_AGE_SEC },
  };
}

/**
 * `POST /setup/key` — store (or rotate) the installation's credential. Re-checks ownership
 * against the session (never a hidden field alone), validates the credential against the path it
 * will actually run on, then encrypts + stores it with its auth type.
 */
export async function handleKeySubmit(
  input: {
    sessionId: string | null;
    installationId: number | null;
    authType: InstallationAuthType | null;
    secret: string | null;
  },
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
    return html(403, renderErrorPage('Not authorized', 'You are not authorized to set the credential for this installation.'));
  }
  const installationId = input.installationId;

  const authType = input.authType;
  if (authType !== 'api_key' && authType !== 'subscription') {
    return html(400, renderCredentialForm(installationId, 'Choose how you want to connect.'));
  }
  if (authType === 'subscription' && !deps.allowSubscriptionAuth) {
    return html(
      400,
      renderCredentialForm(
        installationId,
        'This Tsukinome deployment has subscription auth switched off. Use an Anthropic API key.',
      ),
    );
  }

  const secret = (input.secret ?? '').trim();
  if (!secret) {
    const missing =
      authType === 'subscription'
        ? 'Please paste the token from `claude setup-token`.'
        : 'Please paste your Anthropic API key.';
    return html(400, renderCredentialForm(installationId, missing));
  }

  const validate = authType === 'subscription' ? deps.validateSubscriptionToken : deps.validateKey;
  let valid: boolean;
  try {
    valid = await validate(secret);
  } catch (err) {
    deps.log.error({ err: err instanceof Error ? err.message : String(err), authType }, 'Credential validation errored');
    return html(502, renderCredentialForm(installationId, "Couldn't reach Anthropic to check that. Please try again."));
  }
  if (!valid) {
    const rejected =
      authType === 'subscription'
        ? "Anthropic didn't accept that subscription token. Re-run `claude setup-token` and try again."
        : 'Anthropic rejected that key. Check it and try again.';
    return html(400, renderCredentialForm(installationId, rejected));
  }

  await writeInstallationAuth(deps.vault, deps.store, installationId, authType, secret);
  deps.log.info({ installationId, authType }, 'Stored Anthropic credential for installation');
  return html(200, renderSuccessPage(installationId, authType));
}
