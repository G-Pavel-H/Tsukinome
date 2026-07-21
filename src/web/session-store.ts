import { randomBytes } from 'node:crypto';

/**
 * An authenticated setup session (Phase 12b): the set of installation ids the visitor
 * proved (via GitHub OAuth) they manage. We store *only* the verified ids — the OAuth
 * user token is used once at the callback and discarded, never persisted.
 */
export interface SetupSession {
  verifiedInstallationIds: number[];
  login?: string;
  expiresAt: number;
}

interface PendingState {
  installationId: number;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * In-memory, TTL-bounded store for the OAuth handshake — pre-auth `state` tokens and
 * post-auth sessions. Single-process is a locked decision (server + worker share one
 * process), so an in-memory map is sufficient; a restart simply asks the user to
 * re-authenticate. `now` is injectable for deterministic expiry tests.
 */
export class SessionStore {
  private readonly states = new Map<string, PendingState>();
  private readonly sessions = new Map<string, SetupSession>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(opts: { ttlMs?: number; now?: () => number } = {}) {
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.now = opts.now ?? Date.now;
  }

  /** Mint a one-time OAuth `state` token bound to the installation being set up. */
  createState(installationId: number): string {
    const state = randomBytes(24).toString('base64url');
    this.states.set(state, { installationId, expiresAt: this.now() + this.ttlMs });
    return state;
  }

  /** Consume a `state` token (one-time), returning its installation id or null. */
  consumeState(state: string): number | null {
    const pending = this.states.get(state);
    if (!pending) return null;
    this.states.delete(state);
    if (pending.expiresAt < this.now()) return null;
    return pending.installationId;
  }

  /** Create an authenticated session carrying the visitor's verified installations. */
  createSession(data: { verifiedInstallationIds: number[]; login?: string }): string {
    const id = randomBytes(24).toString('base64url');
    this.sessions.set(id, {
      verifiedInstallationIds: [...data.verifiedInstallationIds],
      login: data.login,
      expiresAt: this.now() + this.ttlMs,
    });
    return id;
  }

  /** Fetch a live session, or null if unknown/expired. */
  getSession(sessionId: string): SetupSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    if (session.expiresAt < this.now()) {
      this.sessions.delete(sessionId);
      return null;
    }
    return session;
  }
}
