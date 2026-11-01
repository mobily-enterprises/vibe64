// Per-key promise bookkeeping: operations that run one at a time per key, and
// operations that callers for the same key share while one is in flight.

function ignoreFailure() {
  return null;
}

/**
 * Runs operations one at a time per key. Each operation starts once the key's
 * previous operation has settled, whatever its outcome, and its own outcome
 * goes to its caller alone. A key is forgotten once its last operation settles.
 */
function createKeyedQueue() {
  /** @type {Map<string, Promise<unknown>>} */
  const tails = new Map();

  /**
   * @template T
   * @param {string} key
   * @param {() => T | Promise<T>} operation
   * @returns {Promise<Awaited<T>>}
   */
  function run(key, operation) {
    const previous = tails.get(key) || Promise.resolve();
    const result = previous.then(() => operation());
    const tail = result.catch(ignoreFailure).finally(() => {
      if (tails.get(key) === tail) {
        tails.delete(key);
      }
    });
    tails.set(key, tail);
    return result;
  }

  /**
   * Settles once every operation queued for the key so far has settled.
   * @param {string} key
   */
  function settled(key) {
    return tails.get(key) || Promise.resolve();
  }

  return Object.freeze({ run, settled });
}

/**
 * Shares one operation per key: a caller for a key whose operation is still in
 * flight receives that operation's promise, and the key is free again once the
 * operation settles.
 */
function createSharedOperations() {
  /** @type {Map<string, Promise<unknown>>} */
  const inFlight = new Map();

  /**
   * @template T
   * @param {string} key
   * @param {() => T | Promise<T>} operation
   * @returns {Promise<Awaited<T>>}
   */
  function run(key, operation) {
    const existing = inFlight.get(key);
    if (existing) {
      return /** @type {Promise<Awaited<T>>} */ (existing);
    }
    const started = Promise.resolve().then(() => operation()).finally(() => {
      if (inFlight.get(key) === started) {
        inFlight.delete(key);
      }
    });
    inFlight.set(key, started);
    return started;
  }

  /**
   * @param {string} key
   */
  function has(key) {
    return inFlight.has(key);
  }

  /** The operations still in flight. */
  function pending() {
    return [...inFlight.values()];
  }

  return Object.freeze({ has, pending, run });
}

export { createKeyedQueue, createSharedOperations };
