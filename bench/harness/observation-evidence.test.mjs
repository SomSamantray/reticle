import { describe, expect, it } from 'vitest';
import {
  EVIDENCE_CHARS,
  captureText,
  evidenceKey,
  mergeEvidence,
} from './observation-evidence.mjs';

/**
 * A detection that failed, with no record of what the tool returned, is unfalsifiable.
 *
 * This was not hypothetical. Fixing the network-timeout tautology moved a COMPETITOR's score down:
 * Playwright went from detecting that scenario to missing it. That is the single result on this
 * benchmark that most deserves suspicion, because it is the one where being wrong flatters us — and
 * the harness had thrown away the only thing that could settle it, the text the grader actually read.
 *
 * The claim "Playwright cannot express an unresolved request" and the claim "our regex does not match
 * the way Playwright words it" produce an identical row. Keeping the graded text is what separates
 * them, and a benchmark that gets a rival's score wrong in its own favour is worth less than no
 * benchmark at all.
 *
 * Recording more is not measuring differently, so none of this changes a verdict or the harness
 * revision.
 */

const entry = (scenario, tool, text = 'x') => ({ scenario, tool, obsText: text });

describe('evidenceKey', () => {
  it('identifies a cell by scenario and tool', () => {
    expect(evidenceKey(entry('network-timeout', 'playwright'))).toBe('network-timeout/playwright');
  });

  it('separates the same scenario across tools', () => {
    expect(evidenceKey(entry('a', 'reticle'))).not.toBe(evidenceKey(entry('a', 'devtools')));
  });
});

describe('captureText', () => {
  it('keeps short text whole and says it was not truncated', () => {
    const c = captureText('a listing');
    expect(c.text).toBe('a listing');
    expect(c.truncated).toBe(false);
    expect(c.chars).toBe(9);
  });

  it('truncates a huge listing but records its REAL length', () => {
    // The full length is the honest number even when the stored text is not, because a reader
    // deciding whether the evidence is complete needs to know what was dropped.
    const c = captureText('z'.repeat(EVIDENCE_CHARS + 500));
    expect(c.text.length).toBe(EVIDENCE_CHARS);
    expect(c.truncated).toBe(true);
    expect(c.chars).toBe(EVIDENCE_CHARS + 500);
  });

  it('treats absent text as empty rather than throwing', () => {
    expect(captureText(undefined).text).toBe('');
    expect(captureText(null).chars).toBe(0);
  });
});

describe('mergeEvidence', () => {
  /**
   * The reason this merges at all. `run-observation.mjs` takes an optional single scenario id, and
   * that targeted run REWRITES the results file with only its own rows. Evidence must not inherit
   * that: re-checking one disputed cell should add to the record, not erase the other thirty-five.
   */
  it('adds a fresh cell without disturbing the others', () => {
    const merged = mergeEvidence(
      [entry('a', 'reticle'), entry('b', 'reticle')],
      [entry('c', 'reticle')],
    );
    expect(merged.map(evidenceKey).sort()).toEqual(['a/reticle', 'b/reticle', 'c/reticle']);
  });

  it('replaces a cell measured again, because the newer reading is the true one', () => {
    const merged = mergeEvidence([entry('a', 'reticle', 'old')], [entry('a', 'reticle', 'new')]);
    expect(merged).toHaveLength(1);
    expect(merged[0].obsText).toBe('new');
  });

  it('survives a missing or malformed store rather than losing the run', () => {
    // A half-written file must not cost the evidence this run just produced.
    expect(mergeEvidence(undefined, [entry('a', 'reticle')])).toHaveLength(1);
    expect(mergeEvidence('not an array', [entry('a', 'reticle')])).toHaveLength(1);
    expect(mergeEvidence([null, 'junk', entry('a', 'reticle')], [])).toHaveLength(1);
  });

  it('is stable in order, so a diff of the store shows what changed and not a reshuffle', () => {
    const merged = mergeEvidence([entry('b', 'x'), entry('a', 'x')], [entry('a', 'x', 'fresh')]);
    expect(merged.map(evidenceKey)).toEqual(['b/x', 'a/x']);
  });
});
