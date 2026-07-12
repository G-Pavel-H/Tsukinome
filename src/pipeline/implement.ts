/** Phase 8 implementation-loop issue comments. */

/** How many human-guided retries the "stuck" gate allows before stopping for real. */
export const IMPL_HELP_CAP = 3;

export function renderImplementationDoneComment(taskCount: number): string {
  return (
    `🛠️ **Implementation complete.** Built ${taskCount} task${taskCount === 1 ? '' : 's'} ` +
    'test-first (each observed red → green) with the full suite green. Moving to review.'
  );
}

/**
 * The "stuck" gate: instead of dead-ending, invite the maintainer to steer a retry. Shows the
 * failing test output and the two ways forward (guidance or `/abort`).
 */
export function renderEscalationComment(
  taskTitle: string,
  stage?: 'test' | 'impl',
  failureOutput?: string,
): string {
  const where = stage === 'test' ? 'writing a failing test' : 'getting the implementation green';
  const base =
    `🙋 **I’m stuck on “${taskTitle}” (${where}) and could use your help.** I hit my retry budget, ` +
    'so I’ve paused rather than guess. **Reply here with guidance** — e.g. tell me which test or ' +
    'acceptance criterion to drop, or how to approach it — and I’ll try again (I still make the ' +
    'remaining tests pass before committing). Reply `/abort` to stop. Here’s what I couldn’t get ' +
    'green:';
  return base + renderTestOutputBlock(failureOutput);
}

/** Acknowledge the maintainer's guidance and signal the retry is starting. */
export function renderImplHelpAckComment(): string {
  return (
    '👍 **On it — retrying with your guidance.** I’ll fold that in and try to get the suite green ' +
    'again.'
  );
}

/** All guided retries used up — stop for real. */
export function renderImplHelpExhaustedComment(): string {
  return (
    '🛑 **I’ve used up the guided retries and still couldn’t land this green**, so I’m stopping ' +
    'here rather than loop. The work so far is on the branch for you to take over.'
  );
}

/** The maintainer chose to stop at the gate. */
export function renderImplAbortComment(): string {
  return '🚪 **Okay, I’ve stopped work on this issue.** Comment again if you’d like me to pick it back up.';
}

/** A collapsible block with the last test-run tail, so a human sees *why* the loop stalled. */
export function renderTestOutputBlock(failureOutput?: string): string {
  if (!failureOutput || !failureOutput.trim()) return '';
  return (
    '\n\n<details><summary>Last test-run output</summary>\n\n```\n' +
    failureOutput.trim() +
    '\n```\n</details>'
  );
}
