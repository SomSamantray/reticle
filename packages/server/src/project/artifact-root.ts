import { join } from 'node:path';
import { ReticleDir } from '@reticlehq/core';
import type { ConfigDiscovery } from '../cli/config-discovery.js';

/**
 * Which `.reticle/` a session's artifacts belong in.
 *
 * Everything Reticle persists — flows, the capability contract, baselines, capsules, the cross-run
 * project memory — used to resolve against the DAEMON's own `process.cwd()`. That is a statement
 * about where the daemon was launched and it was being read as a statement about which project is
 * being verified. Those are not the same thing and are usually not even the same tree: a user-scoped
 * MCP registration is the common case, and the editor that spawns it starts it wherever it likes.
 *
 * Three field shapes, one defect: `cwd=/` gave `ENOENT: mkdir '/.reticle'`; a daemon started in
 * project A wrote project B's flow into A's checkout and reported success without naming the path;
 * and `verify_change` could only answer "unknown" because no flow could be persisted for it to match
 * against.
 *
 * ## Why matching on projectId, and not a new wire field
 *
 * HELLO already stamps `projectId`, and `.reticle.json` already declares the same id sitting next to
 * the code it configures. The join is therefore available today, for every SDK already in the field.
 * Adding a `root` to HELLO would move the wire contract, strand every older SDK on the fallback, and
 * buy nothing this does not already give.
 *
 * ## Why it can decline to answer
 *
 * Every non-matching branch returns the daemon root and SAYS which branch it was. A wrong root is
 * worse than no root — it writes a caller's evidence into a tree they never drove — so the ambiguous
 * case refuses rather than picks, exactly as `discoverProjectConfigs` refuses to pick one config.
 * The reason travels with the answer so callers can report the surprise instead of hiding it.
 */

/** Why the root below is the root. Travels with the answer so a caller can say what happened. */
export const ArtifactRootReason = {
  /** Exactly one discovered config declares this session's project. The good case. */
  MATCHED_PROJECT: 'matched-project',
  /** The session declared no projectId — a pre-2.0 SDK. Nothing to match on. */
  NO_PROJECT_ID: 'no-project-id',
  /** The search ran and nothing it found declares this project. */
  NO_MATCH: 'no-match',
  /** Two or more checkouts declare this project. Refused rather than guessed. */
  AMBIGUOUS: 'ambiguous',
} as const;
export type ArtifactRootReason = (typeof ArtifactRootReason)[keyof typeof ArtifactRootReason];

export interface ArtifactRootQuery {
  /** The connected session's HELLO projectId, when it sent one. */
  projectId: string | undefined;
  /** What the config search found. Supplied, not performed here — this stays pure. */
  discovery: ConfigDiscovery;
  /** Where artifacts go when the project cannot be identified. Already a `.reticle` path. */
  daemonRoot: string;
}

export interface ArtifactRoot {
  /** Absolute path to the `.reticle` directory. Always present, on every branch. */
  root: string;
  reason: ArtifactRootReason;
  /**
   * The competing project directories, on `AMBIGUOUS` only. A caller that has to explain the refusal
   * needs to name them; a caller that does not can ignore the field.
   */
  candidates?: string[];
}

/**
 * Resolve the artifact root for one session.
 *
 * Pure: no IO, no cwd, no clock. The filesystem walk belongs to `discoverProjectConfigs` and is
 * passed in, which is what makes every branch below testable without a fixture tree.
 */
export function resolveArtifactRoot(query: ArtifactRootQuery): ArtifactRoot {
  const { projectId, discovery, daemonRoot } = query;

  if (projectId === undefined || 0 === projectId.length) {
    return { root: daemonRoot, reason: ArtifactRootReason.NO_PROJECT_ID };
  }

  const matches = discovery.found.filter((config) => config.projectId === projectId);

  if (0 === matches.length) {
    return { root: daemonRoot, reason: ArtifactRootReason.NO_MATCH };
  }

  if (matches.length > 1) {
    return {
      root: daemonRoot,
      reason: ArtifactRootReason.AMBIGUOUS,
      candidates: matches.map((config) => config.directory),
    };
  }

  const [only] = matches;
  // `matches.length === 1` above, so this is defined — but the codebase forbids `!`, and a default
  // that can never be taken is cheaper than the alternative spelling.
  const directory = only?.directory ?? '';
  if (0 === directory.length) {
    return { root: daemonRoot, reason: ArtifactRootReason.NO_MATCH };
  }

  return { root: join(directory, ReticleDir.ROOT), reason: ArtifactRootReason.MATCHED_PROJECT };
}
