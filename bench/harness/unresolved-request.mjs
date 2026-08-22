/**
 * Did the tool report that a request never came back?
 *
 * This grader has been wrong twice, in opposite directions, and both errors flattered us.
 *
 * It first matched the word "timeout" against the observation while the endpoint did not exist. The
 * URL is `/api/broken/timeout`, so the word was always present and every tool "detected" a fault none
 * of them had seen: three free true positives on one of ten real-regression scenarios.
 *
 * The repair demanded a word like "pending". Chrome DevTools writes `[pending]` and Reticle writes
 * `"status":"pending"`, so both passed. Playwright reports it STRUCTURALLY — the request appears with
 * no `=> [status]` suffix while every completed request in the same listing has one:
 *
 *     194. [GET] .../api/items?limit=1 => [200] OK
 *     196. [GET] .../api/broken/timeout
 *
 * An agent reading that can tell exactly which request never returned. Our matcher could not, so we
 * scored a competitor as missing a fault it had plainly reported. `bench/README.md` already records
 * this benchmark publishing a rival's number wrongly in our favour once, and says a benchmark that
 * does that is worth less than no benchmark.
 *
 * So the question asked here is about the request's STATE, and a tool may answer it in either
 * vocabulary. The rule stays honest because of what it refuses: a request that COMPLETED never
 * counts, however much its path spells the fault.
 */

/** Ways a tool says, in words, that a request has not settled. */
const EXPLICIT_PENDING = /\b(pending|in[-\s]?flight|unresolved|timed out|hung|no response)\b/i;

/** Ways a tool shows that a request DID settle: `=> [200]`, `[404]`, `"status":200`, `status=500`. */
const COMPLETED = /(=>\s*\[\d{3}\]|\[\d{3}\]|"status"\s*:\s*\d{3}|\bstatus[=:]\s*\d{3})/;

/**
 * `text` is the observation the tool returned; `urlFragment` identifies the request in question.
 *
 * Returns false for anything it cannot read, rather than throwing: a grader that dies mid-pass turns
 * a measured cell into an unmeasured one, and an unmeasured cell used to leave the denominator.
 */
export function unresolvedRequestDetected(text, urlFragment) {
  if ('string' !== typeof text || 'string' !== typeof urlFragment || 0 === urlFragment.length) {
    return false;
  }

  // Split on newlines AND on the object boundaries of a JSON listing, so one request's record is one
  // unit whichever shape the tool emits. Without this, a single-line JSON body would be one "line"
  // and every request's status would count as every other request's.
  const units = text.split(/\n|\},\s*\{/);
  const mentioning = units.filter((unit) => unit.includes(urlFragment));
  if (0 === mentioning.length) return false;

  // Said in words, by the tool, about this request.
  if (mentioning.some((unit) => EXPLICIT_PENDING.test(unit))) return true;

  // Said structurally. Only meaningful when the listing demonstrably DOES report completions
  // elsewhere — otherwise a bare URL is a tool that reports no statuses at all, which says nothing
  // about this request and must not be read as evidence.
  const elsewhere = units.filter((unit) => !unit.includes(urlFragment));
  const listingShowsCompletions = elsewhere.some((unit) => COMPLETED.test(unit));
  if (!listingShowsCompletions) return false;

  return mentioning.some((unit) => !COMPLETED.test(unit));
}
