import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { InMemoryStore } from '../../src/store/memory-store.js';
import { CredentialVault } from '../../src/secrets/credential-vault.js';
import { SessionStore } from '../../src/web/session-store.js';
import {
  handleSetupStart,
  handleCallback,
  handleKeySubmit,
  type SetupDeps,
  type SetupResult,
} from '../../src/web/setup-handlers.js';
import type { GitHubOAuthClient } from '../../src/github/oauth.js';
import { silentLog } from '../helpers.js';

const masterKey = randomBytes(32);

function fakeOauth(opts: { ids?: number[] } = {}): GitHubOAuthClient {
  return {
    buildAuthorizeUrl: ({ state, redirectUri }) =>
      `https://github.com/login/oauth/authorize?client_id=cid&state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`,
    exchangeCode: async () => 'user-token',
    listInstallationIds: async () => opts.ids ?? [42],
  };
}

function assertHtml(r: SetupResult): Extract<SetupResult, { kind: 'html' }> {
  if (r.kind !== 'html') throw new Error(`expected html result, got ${r.kind}`);
  return r;
}

describe('setup handlers', () => {
  let store: InMemoryStore;
  let vault: CredentialVault;
  let sessions: SessionStore;
  let validateKey: ReturnType<typeof vi.fn>;

  function deps(oauth = fakeOauth()): SetupDeps {
    return {
      oauth,
      validateKey,
      vault,
      sessions,
      config: { clientId: 'cid', clientSecret: 'secret', baseUrl: 'https://tsk.example.com' },
      log: silentLog,
    };
  }

  beforeEach(() => {
    store = new InMemoryStore();
    vault = new CredentialVault(store, masterKey);
    sessions = new SessionStore();
    validateKey = vi.fn(async () => true);
  });

  describe('handleSetupStart', () => {
    it('400s when no installation id is supplied', async () => {
      const r = await handleSetupStart({ installationId: null }, deps());
      expect(assertHtml(r).status).toBe(400);
    });

    it('redirects to GitHub authorize with a state that maps back to the installation', async () => {
      const r = await handleSetupStart({ installationId: 42 }, deps());
      expect(r.kind).toBe('redirect');
      const location = (r as Extract<SetupResult, { kind: 'redirect' }>).location;
      const state = new URL(location).searchParams.get('state')!;
      expect(sessions.consumeState(state)).toBe(42);
    });
  });

  describe('handleCallback', () => {
    it('400s on a missing code or state', async () => {
      expect(assertHtml(await handleCallback({ code: null, state: 'x' }, deps())).status).toBe(400);
      expect(assertHtml(await handleCallback({ code: 'x', state: null }, deps())).status).toBe(400);
    });

    it('400s on an unknown/expired state', async () => {
      const r = await handleCallback({ code: 'code', state: 'never-issued' }, deps());
      expect(assertHtml(r).status).toBe(400);
    });

    it('rejects a user who does not manage the installation (403, no session)', async () => {
      const d = deps(fakeOauth({ ids: [1, 2, 3] })); // user manages 1/2/3, not 42
      const state = sessions.createState(42);
      const r = await handleCallback({ code: 'code', state }, d);
      const html = assertHtml(r);
      expect(html.status).toBe(403);
      expect(html.cookie).toBeUndefined();
    });

    it('renders the key form + sets a session cookie for a verified manager', async () => {
      const state = sessions.createState(42);
      const r = await handleCallback({ code: 'code', state }, deps(fakeOauth({ ids: [42, 7] })));
      const html = assertHtml(r);
      expect(html.status).toBe(200);
      expect(html.body).toContain('42'); // the installation id is embedded in the form
      expect(html.cookie).toBeDefined();
      // The cookie names a live session carrying the verified installations.
      expect(sessions.getSession(html.cookie!.value)!.verifiedInstallationIds).toContain(42);
    });
  });

  describe('handleKeySubmit', () => {
    async function verifiedSession(ids: number[] = [42]): Promise<string> {
      const state = sessions.createState(ids[0]!);
      const r = await handleCallback({ code: 'code', state }, deps(fakeOauth({ ids })));
      return assertHtml(r).cookie!.value;
    }

    it('401s without a valid session', async () => {
      const r = await handleKeySubmit(
        { sessionId: null, installationId: 42, apiKey: 'sk-ant-x' },
        deps(),
      );
      expect(assertHtml(r).status).toBe(401);
      expect(validateKey).not.toHaveBeenCalled();
    });

    it('403s when the session does not cover the target installation', async () => {
      const sessionId = await verifiedSession([1, 2, 3]);
      const r = await handleKeySubmit(
        { sessionId, installationId: 42, apiKey: 'sk-ant-x' },
        deps(),
      );
      expect(assertHtml(r).status).toBe(403);
      expect(validateKey).not.toHaveBeenCalled();
      expect(await store.getInstallationCredential(42)).toBeNull();
    });

    it('400s on an empty key', async () => {
      const sessionId = await verifiedSession([42]);
      const r = await handleKeySubmit({ sessionId, installationId: 42, apiKey: '   ' }, deps());
      expect(assertHtml(r).status).toBe(400);
      expect(validateKey).not.toHaveBeenCalled();
    });

    it('rejects a key Anthropic refuses, and stores nothing', async () => {
      validateKey.mockResolvedValue(false);
      const sessionId = await verifiedSession([42]);
      const r = await handleKeySubmit(
        { sessionId, installationId: 42, apiKey: 'sk-ant-bad' },
        deps(),
      );
      expect(assertHtml(r).status).toBe(400);
      expect(await store.getInstallationCredential(42)).toBeNull();
    });

    it('validates, encrypts, and stores a good key for a verified manager', async () => {
      const sessionId = await verifiedSession([42]);
      const r = await handleKeySubmit(
        { sessionId, installationId: 42, apiKey: '  sk-ant-good  ' },
        deps(),
      );
      expect(assertHtml(r).status).toBe(200);
      expect(validateKey).toHaveBeenCalledWith('sk-ant-good'); // trimmed
      expect(await vault.getAnthropicKey(42)).toBe('sk-ant-good');
    });

    it('rotates an existing key on a repeat submit', async () => {
      const sessionId = await verifiedSession([42]);
      await handleKeySubmit({ sessionId, installationId: 42, apiKey: 'sk-ant-old' }, deps());
      await handleKeySubmit({ sessionId, installationId: 42, apiKey: 'sk-ant-new' }, deps());
      expect(await vault.getAnthropicKey(42)).toBe('sk-ant-new');
    });
  });
});
