import { describe, it, expect } from 'vitest';
import { buildAuthorizeUrl } from '../../src/github/oauth.js';

describe('buildAuthorizeUrl', () => {
  it('builds a GitHub authorize URL carrying client_id, redirect_uri, and state', () => {
    const url = buildAuthorizeUrl({
      clientId: 'Iv1.abc123',
      state: 'state-token',
      redirectUri: 'https://tsukinome.example.com/setup/callback',
    });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(parsed.searchParams.get('client_id')).toBe('Iv1.abc123');
    expect(parsed.searchParams.get('state')).toBe('state-token');
    expect(parsed.searchParams.get('redirect_uri')).toBe(
      'https://tsukinome.example.com/setup/callback',
    );
  });
});
