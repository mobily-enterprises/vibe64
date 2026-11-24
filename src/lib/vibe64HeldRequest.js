import { workAnswerLost } from "./vibe64SessionWorkOutcome.js";

// The HTTP client's own message for a failure the server did not word ("Request failed with status 404."): a person
// never sees a status code.
const HTTP_CLIENT_FAILURE = /\bstatus \d{3}\b/u;
// After a lost answer (a dropped connection, or the hosted edge's 502 or 504) the request is sent again after these
// waits, the last repeating; the server holds each request up to two seconds while its work goes on.
const LOST_ANSWER_DELAYS_MS = Object.freeze([1_000, 2_000, 3_000, 5_000]);
const MAX_LOST_ANSWERS = 12;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Follows a request the server holds while its work goes on (its `heldRequests.js`): `send(repeat)` names the same
 * request each time. While the server answers that it is held (`answer[heldAs] === true`), or after an answer that
 * never came back, it sends it again as a repeat, which joins the work or reads its outcome and never starts it. A
 * refusal is passed on as it is; a failure the server did not word (`notWorded`), or Vibe64 staying unreachable
 * (`lostContact`), is said in words.
 * @template T
 * @param {(repeat: boolean) => Promise<T>} send
 * @param {{ heldAs?: string, lostContact: string, notWorded: string, wait?: (ms: number) => Promise<unknown> }} options
 * @returns {Promise<T>}
 */
async function followHeldRequest(send, { heldAs = "creating", lostContact, notWorded, wait = delay }) {
  let lost = 0;
  let repeat = false;
  for (;;) {
    let answer;
    try {
      answer = await send(repeat);
      repeat = true;
    } catch (error) {
      if (!workAnswerLost(error)) {
        throw !error?.code && HTTP_CLIENT_FAILURE.test(String(error?.message || "")) ? new Error(notWorded) : error;
      }
      if (lost >= MAX_LOST_ANSWERS) throw new Error(lostContact);
      await wait(LOST_ANSWER_DELAYS_MS[Math.min(lost, LOST_ANSWER_DELAYS_MS.length - 1)]);
      lost += 1;
      repeat = true;
      continue;
    }
    if (answer?.[heldAs] !== true) return answer;
    lost = 0;
  }
}

export { followHeldRequest };
