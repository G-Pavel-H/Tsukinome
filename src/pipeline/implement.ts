/** Phase 8 implementation-loop issue comments. */

export function renderImplementationDoneComment(taskCount: number): string {
  return (
    `🛠️ **Implementation complete.** Built ${taskCount} task${taskCount === 1 ? '' : 's'} ` +
    'test-first (each observed red → green) with the full suite green. Moving to review.'
  );
}

export function renderEscalationComment(taskTitle: string, stage?: 'test' | 'impl'): string {
  const where = stage === 'test' ? 'writing a failing test' : 'getting the implementation green';
  return (
    `🙋 **I’m stuck and need a human.** I couldn’t get past **${taskTitle}** (${where}) within my ` +
    'retry budget, so I’ve stopped rather than guess or loop. The work so far is committed on the ' +
    'working branch for you to take a look.'
  );
}
