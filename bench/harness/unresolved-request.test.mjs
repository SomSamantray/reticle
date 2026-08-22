import { describe, expect, it } from 'vitest';
import { unresolvedRequestDetected } from './unresolved-request.mjs';

/**
 * Did the tool report the request as never having completed?
 *
 * This grader has now been wrong twice, in opposite directions, and both errors flattered us.
 *
 * First it matched `/timeout/i` against the observation while the endpoint did not exist. The URL
 * `/api/broken/timeout` contains the word, so every tool "detected" a fault none of them had seen —
 * three free true positives on one of ten real-regression scenarios.
 *
 * The repair required a word like "pending", and that was wrong in the other direction. Chrome
 * DevTools writes `[pending]` and Reticle writes `"status":"pending"`, so both passed. Playwright
 * says it STRUCTURALLY: it lists the request with no `=> [status]` suffix, while every completed
 * request on the same listing has one. Captured verbatim:
 *
 *     194. [GET] http://localhost:8787/api/items?limit=1 => [200] OK
 *     196. [GET] http://localhost:8787/api/broken/timeout
 *
 * An agent reading that can tell perfectly well which request never came back. Our regex could not,
 * so we scored a competitor as missing a fault it had plainly reported — the exact failure
 * `bench/README.md` warns about, where a benchmark gets a rival wrong in its own favour.
 *
 * So the rule is about the request's STATE, expressed either way, and the negative control is the
 * original tautology: a request that completed must never count, however much its URL says timeout.
 */

const PW_UNRESOLVED = `### Result
192. [POST] http://localhost:8787/api/login => [200] OK
194. [GET] http://localhost:8787/api/items?limit=1 => [200] OK
196. [GET] http://localhost:8787/api/broken/timeout

Note: 195 static requests not shown.`;

const PW_COMPLETED_404 = `### Result
192. [POST] http://localhost:8787/api/login => [200] OK
196. [GET] http://localhost:8787/api/broken/timeout => [404] Not Found`;

const DEVTOOLS = `reqid=192 POST http://localhost:8787/api/login [200]
reqid=199 GET http://localhost:8787/api/broken/timeout [pending]`;

const RETICLE = `{"calls":[{"method":"POST","url":"http://localhost:8787/api/login","status":200},
{"method":"GET","url":"http://localhost:8787/api/broken/timeout","status":"pending"}]}`;

const URL_FRAGMENT = '/api/broken/timeout';

describe('unresolvedRequestDetected', () => {
  it('credits an explicit pending marker', () => {
    expect(unresolvedRequestDetected(DEVTOOLS, URL_FRAGMENT)).toBe(true);
    expect(unresolvedRequestDetected(RETICLE, URL_FRAGMENT)).toBe(true);
  });

  it('credits a request listed with no response, when its siblings have one', () => {
    // The finding this function exists for. Absence of a status IS the report, and it is only
    // meaningful because the same listing shows statuses for the requests that did complete.
    expect(unresolvedRequestDetected(PW_UNRESOLVED, URL_FRAGMENT)).toBe(true);
  });

  /**
   * The original tautology, as a standing negative control. Before the endpoint existed the request
   * 404'd instantly and every tool matched the word in the URL. A completed request must never count,
   * whatever its path spells.
   */
  it('REFUSES a request that completed, however much its URL says timeout', () => {
    expect(unresolvedRequestDetected(PW_COMPLETED_404, URL_FRAGMENT)).toBe(false);
    expect(
      unresolvedRequestDetected('196. [GET] http://x/api/broken/timeout => [200] OK', URL_FRAGMENT),
    ).toBe(false);
    expect(
      unresolvedRequestDetected('{"url":"http://x/api/broken/timeout","status":404}', URL_FRAGMENT),
    ).toBe(false);
  });

  it('refuses an observation that never names the request at all', () => {
    // A tool whose network listing omits the request entirely has reported nothing about it, and
    // must not inherit credit from the fact that other requests are shown without statuses.
    expect(
      unresolvedRequestDetected('### Result\n192. [POST] http://x/api/login', URL_FRAGMENT),
    ).toBe(false);
    expect(unresolvedRequestDetected('', URL_FRAGMENT)).toBe(false);
  });

  /**
   * Guards the structural clause against crediting a tool that simply never reports statuses. If
   * nothing in the listing shows a completion, then a bare URL says nothing about THIS request.
   */
  it('does not read a status-free listing as evidence of an unresolved request', () => {
    expect(
      unresolvedRequestDetected(
        'GET http://x/api/login\nGET http://x/api/broken/timeout',
        URL_FRAGMENT,
      ),
    ).toBe(false);
  });

  it('tolerates absent input rather than throwing mid-pass', () => {
    expect(unresolvedRequestDetected(undefined, URL_FRAGMENT)).toBe(false);
    expect(unresolvedRequestDetected(PW_UNRESOLVED, undefined)).toBe(false);
  });
});
