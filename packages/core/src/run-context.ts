/**
 * What a run has already established, so the next step does not have to rediscover it.
 *
 * Verification is multi-step, and the only thing holding the thread together is the agent's own
 * context window. When that compacts, or the turn ends, or a sub-agent takes over, the thread is
 * gone and the work restarts. The shape of that shows in the field without needing the theory: long
 * runs of the same read-only call, an agent searching by exhaustion because it no longer remembers
 * what it already saw.
 *
 * **The claim is falsifiable and is meant to be tested, not assumed.** If a run carries a bounded,
 * authoritative summary of what is already established, the read-only share of calls should fall. If
 * it does not move on the benchmark, this feature is wrong and comes out. That is why the cap below
 * is a stated number rather than an emergent one: it is the variable the measurement turns on.
 *
 * ## Two rules stop it becoming the thing it prevents
 *
 * **It must shrink, not grow.** Superseding facts REPLACE rather than append, and the set is capped.
 * A context object that accumulates is a token bomb, and read-only payloads are already the largest
 * thing this product emits.
 *
 * **Memory that can be wrong is worse than no memory.** A stale established fact is precisely the
 * false-green mechanism this product exists to prevent, and stale refs are already the most common
 * error an agent sees from us. So every fact carries the document it was observed under and is
 * dropped the moment that document is replaced — no grace period, no probably-fine.
 *
 * ## What may never go in
 *
 * Only what Reticle OBSERVED. Never what the agent intends, plans, or believes: that is not ours to
 * hold, it is unbounded, and a verification tool that remembers what an agent was thinking is
 * inventing evidence. `remaining` is the one forward-looking field and it is derived mechanically
 * from declared bindings, so it remains a report of a fact — which bindings are undischarged — and
 * not a prediction.
 */

import { IntentState, type Intent } from './intent.js';

/**
 * How many established facts an envelope may carry.
 *
 * A decision written down in one place, because the whole feature is a bet that this block costs
 * fewer tokens than the re-queries it prevents, and a cap that drifts makes that bet unmeasurable.
 * Twelve is enough to hold the refs and routes a single verification thread works with, and small
 * enough that the block stays a footnote on a response rather than a second payload.
 */
export const RUN_ESTABLISHED_CAP = 12;

/**
 * One thing this run established, with the document it was true under.
 *
 * `key` is the SUBJECT — re-establishing the same subject supersedes rather than appends. `fact` is
 * the conclusion in prose, never the transcript it came from: "e12 is the Submit button", not the
 * snapshot that revealed it.
 */
export interface EstablishedFact {
  readonly key: string;
  readonly fact: string;
  readonly source?: string | undefined;
  /** The document this was seen under. Absent only from facts predating document identity. */
  readonly doc?: string | undefined;
}

export interface RunEnvelope {
  readonly id: string;
  readonly step: number;
  readonly intent: readonly string[];
  readonly established: readonly EstablishedFact[];
  readonly remaining: readonly string[];
}

/**
 * Fold new observations into the established set: drop what a navigation invalidated, supersede what
 * was re-observed, and keep the most recent within the cap.
 *
 * An UNSTAMPED fact is kept rather than dropped as foreign, for the same reason unstamped evidence
 * counts as current: an SDK predating document identity stamps nothing, and dropping its facts would
 * make the envelope silently empty instead of honestly smaller.
 */
export function foldEstablished(
  existing: readonly EstablishedFact[],
  incoming: readonly EstablishedFact[],
  currentDocumentId: string | undefined,
): EstablishedFact[] {
  const current = (f: EstablishedFact): boolean =>
    undefined === f.doc || undefined === currentDocumentId || f.doc === currentDocumentId;

  const superseded = new Set(incoming.map((f) => f.key));
  const kept = existing.filter((f) => current(f) && !superseded.has(f.key));
  const fresh = incoming.filter(current);

  // Oldest first, so trimming from the front drops the least recent. `slice` on the tail keeps the
  // newest, which is the half a next step is most likely to need.
  return [...kept, ...fresh].slice(-RUN_ESTABLISHED_CAP);
}

/**
 * The declared intents no verdict has discharged yet.
 *
 * Derived, never inferred. This reports a property of the ledger — which bindings remain unproved —
 * and says nothing about what the agent means to do next.
 */
export function remainingFor(intents: readonly Intent[]): string[] {
  return intents.filter((i) => IntentState.PROVED !== i.state).map((i) => i.statement);
}

/**
 * Assemble the envelope, or nothing at all.
 *
 * `undefined` when there is neither an established fact nor an outstanding intent: an empty block
 * repeated on every response is pure cost for no information, and the fastest way to lose the
 * token argument this feature has to win is to emit one thousands of times a session.
 */
export function buildRunEnvelope(input: {
  runId: string;
  step: number;
  intents: readonly Intent[];
  established: readonly EstablishedFact[];
  currentDocumentId: string | undefined;
}): RunEnvelope | undefined {
  const established = foldEstablished([], input.established, input.currentDocumentId);
  const remaining = remainingFor(input.intents);
  if (0 === established.length && 0 === remaining.length) return undefined;
  return {
    id: input.runId,
    step: input.step,
    intent: input.intents.map((i) => i.id),
    established,
    remaining,
  };
}
