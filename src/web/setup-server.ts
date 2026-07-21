import type http from 'node:http';
import type { Logger } from '../log.js';
import type { CredentialVault } from '../secrets/credential-vault.js';
import type { AnthropicKeyValidator } from '../secrets/anthropic-validator.js';
import type { GitHubOAuthClient } from '../github/oauth.js';
import { SessionStore } from './session-store.js';
import {
  handleCallback,
  handleKeySubmit,
  handleSetupStart,
  SETUP_COOKIE,
  type SetupDeps,
  type SetupResult,
} from './setup-handlers.js';
import { renderNotConfiguredPage } from './setup-pages.js';

type Middleware = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  next: (err?: Error) => void,
) => void;

export interface SetupServerConfig {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
}

export interface SetupServerDeps {
  oauth: GitHubOAuthClient;
  validateKey: AnthropicKeyValidator;
  vault: CredentialVault;
  config: SetupServerConfig;
  log: Logger;
  /** Optional injected session store (tests); a fresh one is created otherwise. */
  sessions?: SessionStore;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 64 * 1024) reject(new Error('body too large')); // setup forms are tiny
      else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseIntOrNull(v: string | null): number | null {
  if (v === null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

function writeResult(res: http.ServerResponse, result: SetupResult): void {
  if (result.kind === 'redirect') {
    res.writeHead(302, { Location: result.location });
    res.end();
    return;
  }
  const headers: Record<string, string> = { 'Content-Type': 'text/html; charset=utf-8' };
  if (result.cookie) {
    headers['Set-Cookie'] =
      `${result.cookie.name}=${result.cookie.value}; HttpOnly; SameSite=Lax; Path=/setup; ` +
      `Max-Age=${result.cookie.maxAgeSec}`;
  }
  res.writeHead(result.status, headers);
  res.end(result.body);
}

/**
 * Build the setup-page middleware (Phase 12b). Handles `/setup`, `/setup/callback`, and
 * `POST /setup/key`; calls `next()` for anything else so the webhook middleware still runs.
 *
 * Pass `null` when the deployment hasn't configured OAuth — then `/setup*` renders a clear
 * "not configured" page and the rest of the app is unaffected (optional, graceful path).
 */
export function createSetupMiddleware(deps: SetupServerDeps | null): Middleware {
  const sessions = deps?.sessions ?? new SessionStore();
  const handlerDeps: SetupDeps | null = deps
    ? {
        oauth: deps.oauth,
        validateKey: deps.validateKey,
        vault: deps.vault,
        sessions,
        config: deps.config,
        log: deps.log,
      }
    : null;

  return (req, res, next): void => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    if (path !== '/setup' && path !== '/setup/callback' && path !== '/setup/key') {
      next();
      return;
    }

    if (!handlerDeps) {
      res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderNotConfiguredPage());
      return;
    }

    void (async (): Promise<void> => {
      try {
        if (req.method === 'GET' && path === '/setup') {
          const installationId = parseIntOrNull(url.searchParams.get('installation_id'));
          writeResult(res, await handleSetupStart({ installationId }, handlerDeps));
          return;
        }
        if (req.method === 'GET' && path === '/setup/callback') {
          writeResult(
            res,
            await handleCallback(
              { code: url.searchParams.get('code'), state: url.searchParams.get('state') },
              handlerDeps,
            ),
          );
          return;
        }
        if (req.method === 'POST' && path === '/setup/key') {
          const body = new URLSearchParams(await readBody(req));
          const cookies = parseCookies(req.headers.cookie);
          writeResult(
            res,
            await handleKeySubmit(
              {
                sessionId: cookies[SETUP_COOKIE] ?? null,
                installationId: parseIntOrNull(body.get('installation_id')),
                apiKey: body.get('api_key'),
              },
              handlerDeps,
            ),
          );
          return;
        }
        // A known /setup path but wrong method.
        res.writeHead(405, { 'Content-Type': 'text/plain' });
        res.end('method not allowed');
      } catch (err) {
        deps!.log.error(
          { err: err instanceof Error ? err.message : String(err), path },
          'Setup route errored',
        );
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('internal error');
      }
    })();
  };
}
