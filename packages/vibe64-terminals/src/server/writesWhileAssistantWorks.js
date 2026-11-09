/**
 * The writes that run while the AI works (Save, Update, Save's recovery), each holding its session's agent-write
 * lock for its whole run. Stop and steers never wait for one: they run without the lock (`withoutLock`), and the
 * write lets the lock go only once they finish, so whatever waits for the lock reads what they wrote. Routing work
 * a turn leaves behind waits for such a write to end instead of giving up after the usual wait (`holds`,
 * `started`), and a Stop already waiting for the lock learns when one takes it (`nextHold`).
 */
function createWritesWhileAssistantWorks() {
  // Per session: the write holding its lock now, with the lock-free work it waits for.
  const holding = new Map();
  // Per session: how many such writes have held its lock.
  const starts = new Map();
  // Per session: who waits for the next such write to hold its lock.
  const waiters = new Map();

  function started(sessionId) {
    return starts.get(sessionId) || 0;
  }

  /**
   * Runs the write, already inside the session's agent-write lock.
   * @template T
   * @param {string} sessionId
   * @param {() => Promise<T>} operation
   * @returns {Promise<T>}
   */
  async function hold(sessionId, operation) {
    const write = { lockFree: new Set() };
    holding.set(sessionId, write);
    starts.set(sessionId, started(sessionId) + 1);
    for (const wake of [...(waiters.get(sessionId) || [])]) wake();
    try {
      return await operation();
    } finally {
      holding.delete(sessionId);
      await Promise.allSettled([...write.lockFree]);
    }
  }

  /**
   * Starts `operation` without the lock while such a write holds it, and returns its promise; null otherwise.
   * @template T
   * @param {string} sessionId
   * @param {() => Promise<T>} operation
   * @returns {Promise<T> | null}
   */
  function withoutLock(sessionId, operation) {
    const write = holding.get(sessionId);
    if (!write) return null;
    const running = operation();
    write.lockFree.add(running);
    const forget = () => write.lockFree.delete(running);
    running.then(forget, forget);
    return running;
  }

  /**
   * Resolves when such a write next holds the session's lock; `signal` stops the wait.
   * @param {string} sessionId
   * @param {AbortSignal} signal
   * @returns {Promise<void>}
   */
  function nextHold(sessionId, signal) {
    return new Promise((resolve) => {
      const wakes = waiters.get(sessionId) || new Set();
      waiters.set(sessionId, wakes);
      const forget = () => {
        wakes.delete(wake);
        if (!wakes.size) waiters.delete(sessionId);
      };
      const wake = () => {
        forget();
        resolve();
      };
      wakes.add(wake);
      signal.addEventListener("abort", forget, { once: true });
    });
  }

  /**
   * Whether such a write holds the session's lock now.
   * @param {string} sessionId
   */
  function holds(sessionId) {
    return holding.has(sessionId);
  }

  return Object.freeze({
    hold,
    holds,
    nextHold,
    started,
    withoutLock
  });
}

/** For routing whose session no such write holds (a temporary chat's). */
const NO_WRITES_WHILE_ASSISTANT_WORKS = Object.freeze({
  hold: (_sessionId, operation) => operation(),
  holds: () => false,
  nextHold: () => new Promise(() => {}),
  started: () => 0,
  withoutLock: () => null
});

export {
  createWritesWhileAssistantWorks,
  NO_WRITES_WHILE_ASSISTANT_WORKS
};
