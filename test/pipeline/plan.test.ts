import { describe, it, expect } from 'vitest';
import {
  PLAN_REVISION_CAP,
  definitionOfReady,
  parsePlanDecision,
  renderPlanGateComment,
  renderPlanMarkdown,
} from '../../src/pipeline/plan.js';
import type { Plan, Spec } from '../../src/pipeline/schemas.js';

const spec: Spec = {
  summary: 'Add a JSON export of the report.',
  requirements: [{ id: 'R1', statement: 'Export is JSON.', confidence: 'explicit' }],
  acceptanceCriteria: [
    { id: 'AC1', given: 'data exists', when: 'export runs', then: 'a JSON file is produced' },
  ],
  nonGoals: ['CSV export'],
  edgeCases: ['empty dataset'],
  assumptions: [],
  openQuestions: [],
};

const plan: Plan = {
  summary: 'Add an exporter module and wire it to the report command.',
  approach: 'Reuse the existing serializer; add an `exportJson` function.',
  affectedFiles: [
    { path: 'src/export.ts', change: 'add', reason: 'new exporter' },
    { path: 'src/cli.ts', change: 'modify', reason: 'wire the command' },
  ],
  contracts: ['export function exportJson(report: Report): string'],
  dataChanges: [],
  testStrategy: ['Unit test exportJson against AC1 (red→green)'],
};

describe('renderPlanMarkdown', () => {
  const md = renderPlanMarkdown(plan, { issueNumber: 42, title: 'JSON export' });

  it('includes the approach, affected files, contracts, and test strategy', () => {
    expect(md).toContain('Add an exporter module');
    expect(md).toContain('src/export.ts');
    expect(md).toContain('exportJson');
    expect(md).toContain('AC1');
  });
});

describe('renderPlanGateComment', () => {
  const comment = renderPlanGateComment(spec, plan);

  it('presents spec + plan together with the gate instructions', () => {
    expect(comment).toContain('JSON'); // spec summary surfaced
    expect(comment).toContain('src/export.ts'); // plan surfaced
    expect(comment).toContain('/approve');
    expect(comment).toContain('/abort');
  });
});

describe('definitionOfReady', () => {
  it('is ready for a clean spec', () => {
    expect(definitionOfReady(spec).ready).toBe(true);
  });

  it('is not ready when open questions remain', () => {
    const dor = definitionOfReady({ ...spec, openQuestions: ['Which format exactly?'] });
    expect(dor.ready).toBe(false);
    expect(dor.reasons.join(' ').toLowerCase()).toContain('question');
  });

  it('is not ready without testable acceptance criteria', () => {
    expect(definitionOfReady({ ...spec, acceptanceCriteria: [] }).ready).toBe(false);
  });

  it('is not ready when non-goals are not stated', () => {
    expect(definitionOfReady({ ...spec, nonGoals: [] }).ready).toBe(false);
  });
});

describe('parsePlanDecision', () => {
  it('recognizes /approve', () => {
    expect(parsePlanDecision('looks good, /approve')).toBe('approve');
  });
  it('recognizes /abort', () => {
    expect(parsePlanDecision('/abort this')).toBe('abort');
  });
  it('treats anything else as a change request', () => {
    expect(parsePlanDecision('please use a streaming writer instead')).toBe('changes');
  });
});

describe('PLAN_REVISION_CAP', () => {
  it('is a small positive cap', () => {
    expect(PLAN_REVISION_CAP).toBeGreaterThan(0);
    expect(PLAN_REVISION_CAP).toBeLessThanOrEqual(5);
  });
});
