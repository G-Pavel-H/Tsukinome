/** Phase 10 PR fix-loop replies + the per-run fix-round cap. */

export const FIX_ROUND_CAP = 3;

export function renderFixClarifyComment(reason: string): string {
  return (
    `🤔 **Quick question before I change anything.** ${reason} Could you point me at the specific ` +
    'behavior you want different (and where)? I’d rather ask than guess.'
  );
}

export function renderFixReworkComment(): string {
  return (
    '↩️ **This looks bigger than a patch.** It changes the agreed approach, so I’m taking it back to ' +
    'the **plan gate** rather than editing inline — I’ll re-plan from your feedback and re-present for approval.'
  );
}

export function renderFixDoneComment(commitSha: string): string {
  return `✅ **Fixed — test-first.** Pushed \`${commitSha.slice(0, 7)}\` to the branch; CI will re-run. Take another look.`;
}

export function renderFixCapComment(): string {
  return (
    `🙋 **That’s ${FIX_ROUND_CAP} rounds of fixes on this PR.** To avoid churning, I’m handing this ` +
    'back to a human — please take it from here or open a fresh issue for further changes.'
  );
}

export function renderFixEscalationComment(): string {
  return (
    '🙋 **I couldn’t land this fix** within my retry budget without breaking the suite, so I’ve ' +
    'stopped rather than guess. A human can take a look — the work so far is on the branch.'
  );
}
