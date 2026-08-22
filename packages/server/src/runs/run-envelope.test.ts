import { describe, expect, it } from 'vitest';
import {
  EventType,
  JOURNAL_FILE_VERSION,
  type JournalAction,
  type ReticleEvent,
} from '@reticlehq/core';
import {
  currentDocumentIdOf,
  establishedFromJournal,
  runEnvelopeEnabled,
  runEnvelopeFor,
  RUN_ENVELOPE_ENV,
} from './run-envelope.js';

function action(over: Partial<JournalAction> = {}): JournalAction {
  return {
    v: JOURNAL_FILE_VERSION,
    actionId: 'c1',
    tool: 'reticle_act',
    args: { ref: 'e12', action: 'click' },
    tRange: { from: 0, to: 10 },
    at: 0,
    ...over,
  };
}

function event(over: Partial<ReticleEvent> = {}): ReticleEvent {
  return { t: 0, type: EventType.DOM_ADDED, data: {}, ...over } as ReticleEvent;
}

describe('establishedFromJournal — only what Reticle observed', () => {
  it('keys a settled action on its ref, so re-driving it supersedes', () => {
    const facts = establishedFromJournal([action({ settled: true })], []);
    expect(facts).toEqual([{ key: 'e12', fact: 'click settled', doc: undefined }]);
  });

  it('records an action that did NOT settle rather than dropping it', () => {
    const facts = establishedFromJournal([action({ settled: false })], []);
    expect(facts[0]?.fact).toBe('click did not settle');
  });

  it('says nothing about an action whose settle outcome was never observed', () => {
    expect(establishedFromJournal([action()], [])).toEqual([]);
  });

  it('falls back to the target text when the call named no ref', () => {
    const facts = establishedFromJournal(
      [action({ args: { target: 'Submit', action: 'click' }, settled: true })],
      [],
    );
    expect(facts[0]?.key).toBe('Submit');
  });

  it('stamps the document the action was observed under', () => {
    const facts = establishedFromJournal(
      [action({ settled: true })],
      [event({ actionId: 'c1', documentId: 'doc00001' })],
    );
    expect(facts[0]?.doc).toBe('doc00001');
  });

  it('files the route under one stable key so only the newest survives', () => {
    const facts = establishedFromJournal(
      [],
      [
        event({ type: EventType.ROUTE_CHANGE, data: { pathname: '/a' } }),
        event({ t: 1, type: EventType.ROUTE_CHANGE, data: { pathname: '/b' } }),
      ],
    );
    expect(facts).toEqual([{ key: 'route', fact: 'route is /b', doc: undefined }]);
  });

  it('never reads further back than the fold can keep', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      action({
        actionId: `c${String(i)}`,
        args: { ref: `e${String(i)}`, action: 'click' },
        settled: true,
      }),
    );
    const facts = establishedFromJournal(many, []);
    expect(facts.length).toBeLessThanOrEqual(12);
    expect(facts.at(-1)?.key).toBe('e39');
  });
});

describe('currentDocumentIdOf', () => {
  it('is the newest stamped observation', () => {
    const id = currentDocumentIdOf([
      event({ documentId: 'doc00001' }),
      event({ t: 1, documentId: 'doc00002' }),
      event({ t: 2 }),
    ]);
    expect(id).toBe('doc00002');
  });

  it('is undefined when nothing stamped anything', () => {
    expect(currentDocumentIdOf([event()])).toBeUndefined();
  });
});

describe('runEnvelopeFor', () => {
  it('drops a fact from a document that has been replaced', () => {
    const envelope = runEnvelopeFor({
      runId: 's1',
      actions: [action({ settled: true })],
      events: [
        event({ actionId: 'c1', documentId: 'doc00001' }),
        event({ t: 1, documentId: 'doc00002' }),
      ],
      intents: [],
    });
    expect(envelope).toBeUndefined();
  });

  it('counts the step off the journal rather than a counter of its own', () => {
    const envelope = runEnvelopeFor({
      runId: 's1',
      actions: [action({ settled: true }), action({ actionId: 'c2', settled: true })],
      events: [],
      intents: [],
    });
    expect(envelope?.step).toBe(2);
    expect(envelope?.id).toBe('s1');
  });
});

describe('runEnvelopeEnabled', () => {
  it('is off by default', () => {
    expect(runEnvelopeEnabled({})).toBe(false);
  });

  it('is on for the truthy forms every other flag here accepts', () => {
    expect(runEnvelopeEnabled({ [RUN_ENVELOPE_ENV]: '1' })).toBe(true);
    expect(runEnvelopeEnabled({ [RUN_ENVELOPE_ENV]: 'true' })).toBe(true);
    expect(runEnvelopeEnabled({ [RUN_ENVELOPE_ENV]: '0' })).toBe(false);
  });
});
