import { describe, it, expect, beforeEach } from 'vitest';
import { Probot, ProbotOctokit } from 'probot';
import { createApp } from '../src/app.js';
import { InMemoryStore } from '../src/store/memory-store.js';
import { silentLog } from './helpers.js';

const TEST_PRIVATE_KEY =
  '-----BEGIN RSA PRIVATE KEY-----\n' +
  'MIIEowIBAAKCAQEA2a2rwplBQLzHPZe5RaAkn6YRCb7VcMl0v+UYbNgP2JCbgjsT\n' +
  'pKqgEIVmkGkLMekPCqe+nBDDfBIGMIW/iKqYGT0JQm35SFLi4OUIMT0Dqz8TJno\n' +
  'yqENGa4RXt15y2GJLRy6S+jGsDdNbNlCb+cjaJuf2y8g6+nfzZ5R6jLgJ2VCBGn0\n' +
  'LRe/Fp4F3dC0okkHoeqEa2YBPnMiGxYJFSTbabWwY2p7OCtAp3MXemjn7tVh8TIp\n' +
  'RsKDtl9IUot6Di8RDM8CoviGDieTr/NDXMnGl2gOKUjuOK8RdHDBfP/kPaGdOzV1\n' +
  'x7ADqIsoSt/MqEFOdp4IBkjZAFXFJCGR1j8VrwIDAQABAoIBAFH1WfXFNMf94MnL\n' +
  'T0S3Tp4RXf4k0mIG1o2GjSOoEjHbjMN0X0z38rK0xGjsRVEJmmQOvMHJ8SHgMuuQ\n' +
  'm/HhRs/xrHz5RrOBHh54bm+MQ4W5jCPlMNiA1FgWaFYbsnm1SmP/upgHgVsFRGex\n' +
  'WJQIaFy03V6wqiGwHJjYMFREjS9eBY0JiZBTxCMgi6GfzUz9fXiRPXRBx7lhPFfe\n' +
  'Rjd1GCIKTvqCW0d2tPyQVEImOE4MG8Eq8EjW4C9X/LumaN9DEnWaKpWfLGmd4oH5\n' +
  'zKsHBi3DKFKtR/gHM1DGvBVeOAEj2K0O0s+yBfrHIl3VJQYefR7LcLBgMN1GJgt3\n' +
  'OGITURECgYEA72t+cnIDE2A3sUwDTNjSxXW0H44wAMEfMm/f+bz6GkECQOlDl7K0\n' +
  'y5p6IOKXLfxGJMrmIaqPR6Xr/CzAh4jLEKvD4Fvk/LiL7fOjcoX8hVBN3dj/O7y\n' +
  'VQCTMXxw4e3Bt7TXx/fTTTMm0fKxsEoZ2lv+NfR+L8QR6LON/wJHnOkCgYEA6J7r\n' +
  '-----END RSA PRIVATE KEY-----\n';

function buildProbot(store: InMemoryStore): Probot {
  const probot = new Probot({
    appId: 1,
    privateKey: TEST_PRIVATE_KEY,
    secret: 'test-secret',
    logLevel: 'silent',
    Octokit: ProbotOctokit.defaults({
      retry: { enabled: false },
      throttle: { enabled: false },
    }),
  });
  // Load with the app factory bound to our in-memory store.
  void probot.load(createApp({ store, log: silentLog }));
  return probot;
}

function issuesOpenedPayload() {
  return {
    action: 'opened',
    issue: { number: 42, title: 'Test issue', body: 'A body' },
    repository: {
      full_name: 'acme/widgets',
      name: 'widgets',
      owner: { login: 'acme' },
    },
    installation: { id: 7 },
  } as const;
}

describe('createApp — issues.opened', () => {
  let store: InMemoryStore;
  let probot: Probot;
  beforeEach(async () => {
    store = new InMemoryStore();
    probot = buildProbot(store);
  });

  it('enqueues an issue_opened job carrying the issue coordinates', async () => {
    await probot.receive({ id: 'delivery-1', name: 'issues', payload: issuesOpenedPayload() as never });

    const job = await store.claimNextJob();
    expect(job).not.toBeNull();
    expect(job!.type).toBe('issue_opened');
    expect(job!.payload).toMatchObject({
      installationId: 7,
      owner: 'acme',
      repo: 'widgets',
      issueNumber: 42,
      deliveryId: 'delivery-1',
    });
  });

  it('enqueues only once for a duplicate webhook delivery', async () => {
    await probot.receive({ id: 'dup', name: 'issues', payload: issuesOpenedPayload() as never });
    await probot.receive({ id: 'dup', name: 'issues', payload: issuesOpenedPayload() as never });

    expect(await store.claimNextJob()).not.toBeNull();
    expect(await store.claimNextJob()).toBeNull();
  });
});
