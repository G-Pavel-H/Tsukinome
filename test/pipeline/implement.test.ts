import { describe, it, expect } from 'vitest';
import { renderEscalationComment } from '../../src/pipeline/implement.js';

describe('renderEscalationComment', () => {
  it('includes the last test-run output when provided', () => {
    const body = renderEscalationComment('formatDuration helper', 'impl', 'Expected "1m 0s" got "1m"');
    expect(body).toContain('formatDuration helper');
    expect(body).toContain('Expected "1m 0s" got "1m"');
  });

  it('omits the output block when there is none', () => {
    const body = renderEscalationComment('formatDuration helper', 'impl');
    expect(body).toContain('formatDuration helper');
    expect(body).not.toContain('test-run output');
  });
});
