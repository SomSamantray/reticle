/**
 * Keep the text the grader actually read, so a detection can be argued with.
 *
 * A cell records whether a tool detected a regression. It did not record WHAT the tool said, and
 * without that a failed detection is unfalsifiable: "the tool cannot express this" and "our regex
 * does not match the way the tool words it" produce an identical row.
 *
 * That gap became concrete the first time it mattered. Fixing the network-timeout tautology moved a
 * COMPETITOR's score down — Playwright went from detecting that scenario to missing it — and the
 * result where being wrong flatters us is the one that needs evidence most. `bench/README.md`
 * already records this benchmark publishing a rival's score as 82 instead of 91 off leftover files;
 * a competitive benchmark that gets a rival wrong in its own favour is worth less than no benchmark.
 *
 * **Recording more is not measuring differently.** Nothing here changes a verdict, a token count or
 * the harness revision, so it does not invalidate any recorded row.
 */

/** How much of one cell's observation to keep. Enough to read a listing, not enough to bloat a diff. */
export const EVIDENCE_CHARS = 6000;

/** A cell is one scenario driven by one tool. */
export function evidenceKey(entry) {
  return `${String(entry?.scenario)}/${String(entry?.tool)}`;
}

/**
 * Store the observation, capped, and say how much there really was.
 *
 * The real length is kept even when the text is not: somebody deciding whether this evidence settles
 * a question needs to know whether they are looking at all of it.
 */
export function captureText(text) {
  const full = 'string' === typeof text ? text : '';
  return {
    text: full.slice(0, EVIDENCE_CHARS),
    truncated: full.length > EVIDENCE_CHARS,
    chars: full.length,
  };
}

/**
 * Fold this run's cells into the stored ones.
 *
 * Merged rather than overwritten because `run-observation.mjs` accepts a single scenario id, and that
 * targeted run rewrites the RESULTS file with only its own rows. Re-checking one disputed cell should
 * add to the record, not erase the other thirty-five — the disputed cell is exactly the one somebody
 * re-runs, so overwrite-semantics would destroy the context that makes it readable.
 *
 * A malformed store is treated as empty rather than fatal: a half-written file must not cost the
 * evidence this run just produced.
 */
export function mergeEvidence(existing, fresh) {
  const kept = Array.isArray(existing)
    ? existing.filter((e) => null !== e && 'object' === typeof e)
    : [];
  const incoming = Array.isArray(fresh)
    ? fresh.filter((e) => null !== e && 'object' === typeof e)
    : [];
  const replacing = new Set(incoming.map(evidenceKey));
  // Stable order: survivors first in their original order, so a diff of the store shows what changed
  // rather than a reshuffle.
  const out = kept.filter((e) => !replacing.has(evidenceKey(e)));
  for (const entry of incoming) out.push(entry);
  return out;
}
