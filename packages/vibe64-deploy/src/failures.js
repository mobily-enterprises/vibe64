// How a Deploy fails, and how it reads the provider again before it does: its refusals (`deployError`, a message a
// person can act on), a read that may answer later (`retryable`), the pauses between such reads (`backoffPauses`) and
// the reads a Deploy makes before it changes anything (`firstRead`). The steps (steps.js) name each for those who
// import them from there.

/** A refusal or failure of a Deploy: `code`, a message a person can act on, and `status` for the caller's answer. */
function deployError(code, message, status = 409, details = {}) {
  return Object.assign(new Error(message), { code, status, details });
}

/** A read of the provider that may answer later: no answer, a 5xx, its rate limit, a thing busy. @param {any} error */
const retryable = (error) => error?.retryable === true;
// A read tried again waits one pause, then two, four and at most six (5, 10, 20 and 30 seconds at the caller's 5).
const BACKOFF_PAUSES_MAX = 6;
/** The pauses before the provider is read again after this many failed reads in a row. @param {number} failures */
const backoffPauses = (failures) => Math.min(2 ** (failures - 1), BACKOFF_PAUSES_MAX);
// How many times a Deploy makes each read it makes before it changes anything: then it stops, nothing changed.
const FIRST_READS = 5;

/**
 * A read a Deploy makes before it changes anything (the offer, the inventory, the edge's addresses), tried again as
 * the loop's reads are while the provider may answer later; after FIRST_READS it stops with
 * `production_deploy_unanswered`, saying in words that nothing changed (the provider's own words are in each retry).
 * @template T @param {any} adapter @param {() => Promise<T>} read
 * @param {{ tell: (event: any) => void, pause: () => Promise<void> | void }} context @returns {Promise<T>}
 */
async function firstRead(adapter, read, { tell, pause }) {
  for (let failures = 1; ; failures += 1) {
    try {
      return await read();
    } catch (error) {
      if (!retryable(error)) throw error;
      if (failures >= FIRST_READS) {
        throw deployError("production_deploy_unanswered",
          `${adapter.title} didn't answer, so the Deploy stopped before changing anything. Deploy again.`, 503);
      }
      tell({ kind: "retry", words: `Reading ${adapter.title} again`, attempt: failures, message: error.message });
      for (let one = 0; one < backoffPauses(failures); one += 1) await pause();
    }
  }
}

export { backoffPauses, deployError, firstRead, retryable };
