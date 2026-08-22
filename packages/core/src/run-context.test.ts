import { describe, expect, it } from 'vitest';
import {
  RUN_ESTABLISHED_CAP,
  foldEstablished,
  remainingFor,
  buildRunEnvelope,
} from './run-context.js';
import { IntentState, type Intent } from './intent.js';

/**
 * What this run has already established, so the next step does not rediscover it.
 *
 * Verification is multi-step and the only thing holding the thread together is the agent's own
 * context window. When that compacts, or the turn ends, or a sub-agent takes over, the thread is
 * gone and the work restarts — visible in the field as long runs of the same read-only call, an
 * agent searching by exhaustion because it no longer remembers what it already saw.
 *
 * The claim is falsifiable and stated as such: if a run carries a bounded, authoritative summary of
 * what is already established, the read-only share of calls falls. If that share does not move, this
 * feature is wrong and comes out.
 *
 * Two rules keep it from becoming the thing it is meant to prevent:
 *
 * **It must shrink, not grow.** Superseding facts REPLACE rather than append, and the whole set is
 * capped by a stated number. A context object that accumulates is a token bomb, and the read-only
 * payloads are already the largest thing this product emits.
 *
 * **Memory that can be wrong is worse than no memory.** A stale established fact is exactly the
 * false-green mechanism this product exists to prevent, so every fact carries the document it was
 * seen under and is dropped when that document is replaced. No exception, no grace period.
 */

const fact = (key: string, text: string, doc?: string) => ({ key, fact: text, doc });

describe('foldEstablished', () => {
  it('keeps a fact that is still current', () => {
    const out = foldEstablished([], [fact('e12', 'e12 is the Send button', 'd3')], 'd3');
    expect(out).toHaveLength(1);
    expect(out[0]?.fact).toBe('e12 is the Send button');
  });

  it('SUPERSEDES rather than appends when the same subject is re-established', () => {
    // The anti-growth rule. Two readings of one subject is one fact, the newer one.
    const first = foldEstablished([], [fact('e12', 'e12 is the Send button', 'd3')], 'd3');
    const out = foldEstablished(first, [fact('e12', 'e12 is the Submit button', 'd3')], 'd3');
    expect(out).toHaveLength(1);
    expect(out[0]?.fact).toBe('e12 is the Submit button');
  });

  /**
   * The rule that makes this safe to trust at all. A fact established under a document that has
   * since been replaced is not stale-ish or probably-fine — it describes a page that no longer
   * exists, and citing it is the false green this product exists to catch.
   */
  it('DROPS every fact established under a replaced document', () => {
    const before = foldEstablished([], [fact('e12', 'e12 is the Send button', 'd3')], 'd3');
    expect(foldEstablished(before, [], 'd4')).toEqual([]);
  });

  it('keeps facts from the current document while dropping the superseded ones', () => {
    const mixed = [fact('a', 'a is old', 'd3'), fact('b', 'b is current', 'd4')];
    const out = foldEstablished(mixed, [], 'd4');
    expect(out.map((f) => f.key)).toEqual(['b']);
  });

  it('caps the set at a stated number, keeping the most recent', () => {
    // The cap is a decision written down in one place, not an emergent property of whatever the
    // journal happened to contain.
    const many = Array.from({ length: RUN_ESTABLISHED_CAP + 5 }, (_, i) =>
      fact(`k${String(i)}`, `fact ${String(i)}`, 'd3'),
    );
    const out = foldEstablished([], many, 'd3');
    expect(out).toHaveLength(RUN_ESTABLISHED_CAP);
    // Most recent kept: the oldest are the ones that fall off.
    expect(out.at(-1)?.key).toBe(`k${String(RUN_ESTABLISHED_CAP + 4)}`);
  });

  /**
   * An unstamped fact predates document identity. It is kept for the same reason unstamped EVIDENCE
   * is treated as current: an older SDK stamps nothing, and dropping its facts would make the
   * envelope silently empty rather than honestly smaller.
   */
  it('keeps an unstamped fact rather than dropping it as foreign', () => {
    expect(foldEstablished([], [fact('e1', 'no document known')], 'd3')).toHaveLength(1);
  });
});

describe('remainingFor', () => {
  const intent = (id: string, state: Intent['state'], statement: string): Intent => ({
    id,
    statement,
    state,
    declaredAt: 0,
  });

  it('lists what no verdict has discharged yet', () => {
    const out = remainingFor([
      intent('i1', IntentState.BOUND, 'the badge should read checked in'),
      intent('i2', IntentState.PROVED, 'the form submits'),
    ]);
    expect(out).toEqual(['the badge should read checked in']);
  });

  it('includes a declared intent, which is undischarged by definition', () => {
    expect(remainingFor([intent('i1', IntentState.DECLARED, 'checkout works')])).toEqual([
      'checkout works',
    ]);
  });

  /**
   * `remaining` is DERIVED, never inferred. It reports which declared bindings are undischarged —
   * a fact about the ledger — and never a guess at what the agent means to do next. A tool that
   * predicts intent is inventing evidence, which is the one thing this envelope must not do.
   */
  it('is empty when everything declared has been proved', () => {
    expect(remainingFor([intent('i1', IntentState.PROVED, 'done')])).toEqual([]);
    expect(remainingFor([])).toEqual([]);
  });
});

describe('buildRunEnvelope', () => {
  it('reports the run, its step, and what is established and outstanding', () => {
    const env = buildRunEnvelope({
      runId: 'run_7f3a',
      step: 6,
      intents: [
        { id: 'i1', statement: 'badge reads checked in', state: IntentState.BOUND, declaredAt: 0 },
      ],
      established: [fact('e12', 'e12 is the Send button', 'd3')],
      currentDocumentId: 'd3',
    });
    // Narrowed explicitly rather than with a non-null assertion, which this repo forbids: if the
    // envelope were unexpectedly absent, the failure should name that rather than a property access.
    if (undefined === env) throw new Error('an envelope with an intent and a fact should be built');
    expect(env.id).toBe('run_7f3a');
    expect(env.step).toBe(6);
    expect(env.intent).toEqual(['i1']);
    expect(env.established).toHaveLength(1);
    expect(env.remaining).toEqual(['badge reads checked in']);
  });

  it('omits the envelope entirely when it would carry nothing', () => {
    // An empty envelope on every response is pure cost for no information. The feature has to earn
    // its bytes on the benchmark, and the cheapest way to lose that argument is to ship a block that
    // says nothing thousands of times a session.
    expect(
      buildRunEnvelope({
        runId: 'r1',
        step: 0,
        intents: [],
        established: [],
        currentDocumentId: 'd1',
      }),
    ).toBeUndefined();
  });
});
