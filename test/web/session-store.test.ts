import { describe, it, expect } from 'vitest';
import { SessionStore } from '../../src/web/session-store.js';

describe('SessionStore', () => {
  it('mints a one-time OAuth state bound to an installation id', () => {
    const s = new SessionStore();
    const state = s.createState(42);
    expect(typeof state).toBe('string');
    expect(state.length).toBeGreaterThan(16);
    expect(s.consumeState(state)).toBe(42);
    // One-time: a second consume returns null.
    expect(s.consumeState(state)).toBeNull();
  });

  it('returns null consuming an unknown state', () => {
    const s = new SessionStore();
    expect(s.consumeState('nope')).toBeNull();
  });

  it('creates and reads back an authenticated session', () => {
    const s = new SessionStore();
    const id = s.createSession({ verifiedInstallationIds: [1, 2, 3], login: 'octocat' });
    const session = s.getSession(id);
    expect(session!.verifiedInstallationIds).toEqual([1, 2, 3]);
    expect(session!.login).toBe('octocat');
  });

  it('returns null for an unknown session id', () => {
    const s = new SessionStore();
    expect(s.getSession('nope')).toBeNull();
  });

  it('expires sessions and states after the TTL', () => {
    let now = 1_000_000;
    const s = new SessionStore({ ttlMs: 1000, now: () => now });
    const state = s.createState(42);
    const id = s.createSession({ verifiedInstallationIds: [42] });

    now += 1001; // past the TTL
    expect(s.consumeState(state)).toBeNull();
    expect(s.getSession(id)).toBeNull();
  });

  it('mints unguessable, distinct ids', () => {
    const s = new SessionStore();
    const a = s.createSession({ verifiedInstallationIds: [1] });
    const b = s.createSession({ verifiedInstallationIds: [1] });
    expect(a).not.toBe(b);
  });
});
