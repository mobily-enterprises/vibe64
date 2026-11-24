import { workAnswerLost } from "./vibe64SessionWorkOutcome.js";

const PULL_REQUEST_LOST_CONTACT =
  "Vibe64 could not be reached to follow this pull request. Check the session's pull request before creating it again.";
const PULL_REQUEST_NOT_CREATED = "Vibe64 could not create this pull request. Check the session's pull request and try again.";
// The HTTP client's own message for a failure the server did not word ("Request failed with status 404."): a person
// never sees a status code.
const HTTP_CLIENT_FAILURE = /\bstatus \d{3}\b/u;
// After a lost answer (a dropped connection, or the hosted edge's 502 or 504) the request is sent again after these
// waits, the last repeating; the server holds each request up to two seconds while the creation goes on.
const LOST_ANSWER_DELAYS_MS = Object.freeze([1_000, 2_000, 3_000, 5_000]);
const MAX_LOST_ANSWERS = 12;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Creates a pull request through the dialog's request, `send`, which names the same request each time: while the
 * server answers that it is creating, or after an answer that never came back, it sends it again, which joins the
 * creation or reads its outcome. A refusal is passed on as it is, and a failure the server did not word, or Vibe64
 * staying unreachable, is said in words.
 * @template T
 * @param {() => Promise<T>} send
 * @param {{ wait?: (ms: number) => Promise<unknown> }} [options]
 * @returns {Promise<T>}
 */
async function createPullRequestFollowed(send, { wait = delay } = {}) {
  let lost = 0;
  for (;;) {
    let answer;
    try {
      answer = await send();
    } catch (error) {
      if (!workAnswerLost(error)) {
        throw !error?.code && HTTP_CLIENT_FAILURE.test(String(error?.message || "")) ? new Error(PULL_REQUEST_NOT_CREATED) : error;
      }
      if (lost >= MAX_LOST_ANSWERS) throw new Error(PULL_REQUEST_LOST_CONTACT);
      await wait(LOST_ANSWER_DELAYS_MS[Math.min(lost, LOST_ANSWER_DELAYS_MS.length - 1)]);
      lost += 1;
      continue;
    }
    if (answer?.creating !== true) return answer;
    lost = 0;
  }
}

export { PULL_REQUEST_LOST_CONTACT, PULL_REQUEST_NOT_CREATED, createPullRequestFollowed };
