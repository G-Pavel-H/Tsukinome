import { describe, it, expect } from 'vitest';
import {
  FIX_ROUND_CAP,
  renderFixCapComment,
  renderFixClarifyComment,
  renderFixDoneComment,
  renderFixEscalationComment,
  renderFixReworkComment,
} from '../../src/pipeline/fix.js';

describe('FIX_ROUND_CAP', () => {
  it('is a small positive cap', () => {
    expect(FIX_ROUND_CAP).toBeGreaterThan(0);
    expect(FIX_ROUND_CAP).toBeLessThanOrEqual(5);
  });
});

describe('fix replies', () => {
  it('clarify surfaces the reason and asks rather than guesses', () => {
    const c = renderFixClarifyComment('it is unclear which format you mean');
    expect(c).toContain('it is unclear which format you mean');
    expect(c.toLowerCase()).toContain('guess');
  });

  it('rework points back to the plan gate', () => {
    expect(renderFixReworkComment().toLowerCase()).toContain('plan gate');
  });

  it('done references the short commit sha', () => {
    expect(renderFixDoneComment('deadbeefcafe')).toContain('deadbee');
  });

  it('cap and escalation hand off to a human', () => {
    expect(renderFixCapComment().toLowerCase()).toContain('human');
    expect(renderFixEscalationComment().toLowerCase()).toContain('human');
  });
});
