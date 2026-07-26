import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Phase 14: the code-index sidecar embeds locally via ONNX Runtime (`fastembed`), NOT
 * PyTorch (`sentence-transformers`). torch is the ~2GB dependency that OOMs small hosts;
 * fastembed runs the *same* MiniLM model on onnxruntime for a fraction of the footprint.
 *
 * This is a CI-runnable guard on the swap's intent (the real behavioural proof is the
 * gated CocoIndex integration test, like E2B/Anthropic). It pins two things measurement
 * showed are load-bearing for memory: `threads=1` (onnxruntime spawns one arena per core
 * otherwise) and a small `batch_size` (keeps the peak near the model-load floor).
 */
describe('code-index sidecar embedding backend (Phase 14)', () => {
  const sidecarDir = join(import.meta.dirname, '..', '..', 'sidecar');
  const flow = readFileSync(join(sidecarDir, 'cocoindex_flow.py'), 'utf-8');
  // Strip comment lines so we assert on real requirements, not the explanatory header.
  const requirements = readFileSync(join(sidecarDir, 'requirements.txt'), 'utf-8')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');

  it('requirements declare fastembed and no torch stack', () => {
    expect(requirements).toMatch(/fastembed/);
    expect(requirements).not.toMatch(/sentence-transformers/);
    expect(requirements).not.toMatch(/\btorch\b/);
  });

  it('the sidecar imports fastembed TextEmbedding, not the torch stack', () => {
    expect(flow).toMatch(/from fastembed import TextEmbedding/);
    expect(flow).toMatch(/TextEmbedding\(/);
    // Guard the code path (imports), not the header comments that explain the swap.
    expect(flow).not.toMatch(/from sentence_transformers import/);
    expect(flow).not.toMatch(/^\s*import torch\b/m);
  });

  it('still uses CocoIndex for chunking (only the embedding step changed)', () => {
    expect(flow).toMatch(/cocoindex/);
    expect(flow).toMatch(/RecursiveSplitter/);
  });

  it('pins the memory-critical knobs: threads=1 and a small batch size', () => {
    expect(flow).toMatch(/threads\s*=\s*1/);
    expect(flow).toMatch(/batch_size/);
  });

  it('keeps the same MiniLM model and 384-dim output (no migration)', () => {
    expect(flow).toMatch(/all-MiniLM-L6-v2/);
    expect(flow).toMatch(/EMBEDDING_DIM\s*=\s*384/);
  });
});
