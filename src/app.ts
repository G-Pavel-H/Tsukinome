import type { Probot } from 'probot';
import type { Logger } from './log.js';
import type { Store } from './store/types.js';

export interface AppDeps {
  store: Store;
  log: Logger;
}

/**
 * Build the Probot app. Webhook handlers do the minimum — dedupe the delivery,
 * enqueue a job, return — so the request returns 200 fast and all real work
 * happens in the worker. Probot handles signature verification and the response.
 */
export function createApp(deps: AppDeps): (probot: Probot) => void {
  const { store, log } = deps;

  return (probot: Probot): void => {
    probot.on('issues.opened', async (context) => {
      const deliveryId = context.id;
      const repository = context.payload.repository;
      const installationId = context.payload.installation?.id;
      const issueNumber = context.payload.issue.number;

      if (installationId === undefined) {
        log.warn(
          { deliveryId, repo: repository.full_name, issue: issueNumber },
          'issues.opened without an installation id; ignoring',
        );
        return;
      }

      // Dedupe redelivered webhooks: only the first delivery enqueues.
      const fresh = await store.tryMarkEventProcessed(deliveryId);
      if (!fresh) {
        log.info({ deliveryId }, 'Duplicate webhook delivery; already enqueued');
        return;
      }

      await store.enqueueJob({
        type: 'issue_opened',
        payload: {
          installationId,
          owner: repository.owner.login,
          repo: repository.name,
          issueNumber,
          deliveryId,
        },
      });

      log.info(
        { deliveryId, repo: repository.full_name, issue: issueNumber },
        'Enqueued issue_opened job',
      );
    });

    // Activated in later phases (Phase 5 clarification, Phase 10 PR fixes).
    probot.on('issue_comment.created', async (context) => {
      log.info(
        {
          event: 'issue_comment.created',
          repo: context.payload.repository.full_name,
          issue: context.payload.issue.number,
        },
        'Webhook received: issue_comment.created (no-op in Phase 1)',
      );
    });

    probot.on('pull_request_review_comment.created', async (context) => {
      log.info(
        {
          event: 'pull_request_review_comment.created',
          repo: context.payload.repository.full_name,
          pr: context.payload.pull_request.number,
        },
        'Webhook received: pull_request_review_comment.created (no-op in Phase 1)',
      );
    });
  };
}
