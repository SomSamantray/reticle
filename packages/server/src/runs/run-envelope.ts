import {
  EventType,
  RUN_ESTABLISHED_CAP,
  buildRunEnvelope,
  type EstablishedFact,
  type Intent,
  type JournalAction,
  type ReticleEvent,
  type RunEnvelope,
} from '@reticlehq/core';
import { envFlagOn } from '../tools/tool-surface.js';

/**
 * The run, derived from the journal that is already there.
 *
 * `.reticle/sessions/<id>/` already holds an append-only causal ledger of every action dispatched
 * and every event observed. The run is a FOLD over that, never a second store — the same argument
 * that deleted `instrumentation_stalled` from this codebase applies without modification: two ways
 * to compute one number is worse than one way, because the day they disagree the disagreement lands
 * inside a verdict and a user finds it before we do. So nothing here writes: it reads the ledger and
 * folds it, and if the fold is wrong the ledger is still the single authority.
 *
 * **One run per session, for now.** The run id IS the session id. Nothing here assumes that — the id
 * is a parameter, `foldEstablished` is pure, and the envelope carries its own id — so a later
 * multi-run or multi-agent model is a change of caller, not a rewrite. It is not built today because
 * nobody has hit the case, and a coordination model invented ahead of its first user is a guess.
 *
 * Only what Reticle OBSERVED goes in. A settle outcome is an observation. A route change is an
 * observation. What the agent meant to do next is not, and never enters here.
 */

/**
 * Turns the envelope on. Default OFF, deliberately: the feature is a bet that this block costs fewer
 * tokens than the re-queries it prevents, and until the benchmark says so it does not get to be the
 * default. Read like every other behaviour switch here — see `envFlagOn`.
 */
export const RUN_ENVELOPE_ENV = 'RETICLE_RUN_ENVELOPE';

/**
 * The one key the route is filed under.
 *
 * The subject of "the app is on /checkout" is the route itself, so a later route change SUPERSEDES
 * rather than appends. Filing it per-path would accumulate every page ever visited, which is the
 * token bomb the cap exists to prevent.
 */
const ROUTE_KEY = 'route';

/** The conclusions this fold is allowed to state, as prose rather than transcript. */
const Fact = {
  route: (to: string): string => `route is ${to}`,
  settled: (verb: string): string => `${verb} settled`,
  unsettled: (verb: string): string => `${verb} did not settle`,
} as const;

/** The SUBJECT a journal action was about: the ref it spent, else the target it resolved from. */
function subjectOf(action: JournalAction): string | undefined {
  const ref = action.args['ref'];
  if ('string' === typeof ref && ref.length > 0) return ref;
  const target = action.args['target'];
  if ('string' === typeof target && target.length > 0) return target;
  return undefined;
}

/** What the action did, in the caller's own vocabulary — 'click', 'fill', else the tool's name. */
function verbOf(action: JournalAction): string {
  const named = action.args['action'];
  return 'string' === typeof named && named.length > 0 ? named : action.tool;
}

/**
 * The document currently under observation, read off the newest stamped event.
 *
 * `Session` carries no `currentDocumentId` on this branch — document identity is minted browser-side
 * and crosses the wire on every event, and nothing server-side has read it until now. The newest
 * stamped event is therefore the authority, and it is the same authority a `currentDocumentId` field
 * would be derived from if one existed.
 */
export function currentDocumentIdOf(events: readonly ReticleEvent[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const id = events[i]?.documentId;
    if (id !== undefined) return id;
  }
  return undefined;
}

/**
 * Fold the journal into candidate facts, newest last.
 *
 * Only the last `RUN_ESTABLISHED_CAP` actions are read: anything older cannot survive the fold, so
 * parsing it would be work done to throw away. An action with no observed settle outcome states
 * nothing and is skipped — "we drove it and cannot say what happened" is not an established fact,
 * and writing it down as one is how a memory starts lying.
 */
export function establishedFromJournal(
  actions: readonly JournalAction[],
  events: readonly ReticleEvent[],
): EstablishedFact[] {
  const docByAction = new Map<string, string>();
  let route: EstablishedFact | undefined;
  for (const event of events) {
    if (event.actionId !== undefined && event.documentId !== undefined) {
      docByAction.set(event.actionId, event.documentId);
    }
    if (EventType.ROUTE_CHANGE === event.type) {
      const pathname = event.data['pathname'];
      const to = 'string' === typeof pathname ? pathname : event.data['to'];
      if ('string' === typeof to) {
        route = { key: ROUTE_KEY, fact: Fact.route(to), doc: event.documentId };
      }
    }
  }

  const out: EstablishedFact[] = [];
  for (const action of actions.slice(-RUN_ESTABLISHED_CAP)) {
    const settled = action.settled;
    if (undefined === settled) continue;
    const key = subjectOf(action);
    if (undefined === key) continue;
    const verb = verbOf(action);
    out.push({
      key,
      fact: settled ? Fact.settled(verb) : Fact.unsettled(verb),
      doc: docByAction.get(action.actionId),
    });
  }
  if (route !== undefined) out.push(route);
  return out;
}

/**
 * The envelope for one run, or nothing at all.
 *
 * `step` is the journal's action count rather than a counter of its own, for the reason at the top
 * of this file: a second counter is a second thing that can disagree with the ledger.
 */
export function runEnvelopeFor(input: {
  runId: string;
  actions: readonly JournalAction[];
  events: readonly ReticleEvent[];
  intents: readonly Intent[];
}): RunEnvelope | undefined {
  return buildRunEnvelope({
    runId: input.runId,
    step: input.actions.length,
    intents: input.intents,
    established: establishedFromJournal(input.actions, input.events),
    currentDocumentId: currentDocumentIdOf(input.events),
  });
}

/** Is the flag on in this environment? */
export function runEnvelopeEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return envFlagOn(env[RUN_ENVELOPE_ENV]);
}
