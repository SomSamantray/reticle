import { afterEach, describe, expect, it } from 'vitest';
import {
  JOURNAL_FILE_VERSION,
  SessionState,
  type JournalAction,
  type RunEnvelope,
} from '@reticlehq/core';
import type { ToolDef, ToolDeps } from './tools.js';
import { ReticleTool } from './tool-names.js';
import { EnvelopeKey } from './tool-kit.js';
import { runTool } from './invoke-tool.js';
import { RUN_ENVELOPE_ENV } from '../runs/run-envelope.js';
import { BaselineStore } from '../project/baselines.js';
import { RecordingStore } from '../flows/recordings.js';
import { FlowStore } from '../flows/flows.js';
import { ProjectStore } from '../project/project-store.js';
import { AnnotationStore } from '../flows/annotation-store.js';
import { createNodeFileSystem } from '../project/fs-port.js';
import type { Session, SessionManager } from '../session/session.js';

const ROOT = '/tmp/reticle-run-envelope-test/.reticle';
const now = (): number => 0;

const DRIVEN: JournalAction = {
  v: JOURNAL_FILE_VERSION,
  actionId: 'c1',
  tool: ReticleTool.ACT,
  args: { ref: 'e12', action: 'click' },
  settled: true,
  tRange: { from: 0, to: 10 },
  at: 0,
};

function journaledSession(): Session {
  const stub: Partial<Session> = {
    id: 'demo',
    url: 'http://localhost:5173/app',
    command: () => Promise.resolve({ kind: 'command_result', id: 'c', ok: true, result: {} }),
    eventsSince: () => [],
    queryEvents: () => Promise.resolve([]),
    readJournalActions: () => Promise.resolve([DRIVEN]),
    bufferHealth: () => ({ total: 0, dropped: 0 }),
    blindSpots: () => ({}),
    health: () => ({ lastSeenMs: 1, throttled: false, focused: true }),
    getState: () => SessionState.ACTIVE,
    drainInbox: () => [],
    takeSessionLease: () => undefined,
    ageWarning: () => undefined,
  };
  return stub as Session;
}

function fakeDeps(): ToolDeps {
  const sessions: Partial<SessionManager> = { resolve: () => journaledSession() };
  const fs = createNodeFileSystem();
  return {
    sessions: sessions as SessionManager,
    baselines: new BaselineStore(),
    recordings: new RecordingStore(),
    flows: new FlowStore(fs, ROOT, { now }),
    project: new ProjectStore(fs, ROOT, { now }),
    annotations: new AnnotationStore(),
    fs,
    reticleRoot: ROOT,
    now,
  };
}

function stubTool(name: string): ToolDef {
  return { name, description: '', inputSchema: {}, handler: () => Promise.resolve({ ok: true }) };
}

afterEach(() => {
  delete process.env[RUN_ENVELOPE_ENV];
});

describe('the run envelope rides out on a tool result, behind its flag', () => {
  it('is absent by default — the feature has to win on the benchmark first', async () => {
    const result = (await runTool(stubTool(ReticleTool.ACT), fakeDeps(), {})) as Record<
      string,
      unknown
    >;
    expect(result[EnvelopeKey.RUN]).toBeUndefined();
  });

  it('carries what the journal established once the flag is on', async () => {
    process.env[RUN_ENVELOPE_ENV] = '1';
    const result = (await runTool(stubTool(ReticleTool.ACT), fakeDeps(), {})) as Record<
      string,
      unknown
    >;
    const run = result[EnvelopeKey.RUN] as RunEnvelope | undefined;
    expect(run?.id).toBe('demo');
    expect(run?.step).toBe(1);
    expect(run?.established).toEqual([{ key: 'e12', fact: 'click settled', doc: undefined }]);
  });

  it('is a declared key, so a schema-strict client keeps it', async () => {
    const { sessionEnvelopeShape } = await import('./tool-kit.js');
    expect(sessionEnvelopeShape[EnvelopeKey.RUN]).toBeDefined();
  });
});
