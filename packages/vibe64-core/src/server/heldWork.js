import crypto from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { doNothing } from "../shared/doNothing.js";
import { logOperationalEvent } from "./logging.js";

// A request answers with its work's own result when that comes within this long, and otherwise that the work is
// held while it goes on. A proxy in front of a hosted editor ends a request after about a minute: on 24 Nov 2026 a
// Main chat send waited inside its request for a workspace preparation and showed "Request failed with status 504.",
// although the work went on and succeeded.
const HELD_ANSWER_MS = 2_000;
// How long held work's outcome stays readable after it ends, for the page following it.
const HELD_OUTCOME_MS = 15 * 60_000;
// Work that took this long, from its request's arrival to its end, is logged as a warning.
const SLOW_WORK_MS = 1_000;

function noFields() {
  return {};
}

/**
 * Work a request starts and answers before it ends. Each key runs one work at a time: a run for a key whose work
 * is still going (a Retry, a second tab, a reload) joins it and never starts a second, and a run for a key whose work
 * has ended starts it again under a new operation id. A run whose work ends within `answerMs` answers with its
 * result, or rejects with its error, as the request always did; a later one answers that the work is held, with its
 * operation id and what it waits for (`stage`), and `inspect` reports it and, for `outcomeMs` after it ends, its
 * outcome. Each work's timing from its arrival is logged when it ends (`<component>.timing`, at warn when held or
 * slow), and each held answer (`<component>.held`).
 *
 * `held(operation)` is awaited once, before a work's first held answer goes out, and `settled(operation)` when it
 * ends, before its outcome is read; a hook's failure is logged, never the work's. Both receive the live operation:
 * `{ operationId, key, receivedAt, settled, waitingFor, stages, heldAnswer, elapsedMs, result, error }`, which is
 * also what `inspect` returns. `fields(operation)` adds fields to each log line.
 * @param {object} options
 * @param {string} options.component
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} [options.logger]
 * @param {number} [options.answerMs]
 * @param {number} [options.outcomeMs]
 * @param {number} [options.slowMs]
 * @param {{ timing?: string, held?: string }} [options.events] the log event names, by default `<component>.timing`
 *   and `<component>.held`
 * @param {(operation: object) => object} [options.fields]
 * @param {(operation: object) => unknown} [options.held]
 * @param {(operation: object) => unknown} [options.settled]
 */
function createHeldWork({
  component,
  logger = silentLogger,
  answerMs = HELD_ANSWER_MS,
  outcomeMs = HELD_OUTCOME_MS,
  slowMs = SLOW_WORK_MS,
  events = {},
  fields = noFields,
  held = doNothing,
  settled = doNothing
}) {
  const timingEvent = events.timing || `${component}.timing`;
  const heldEvent = events.held || `${component}.held`;
  const entries = new Map();
  const closing = new AbortController();

  /** Logging and hooks are the work's diagnostics and bookkeeping, never its outcome. */
  function log(level, event, entry, extra, message) {
    try {
      logOperationalEvent(logger, level, { ...extra, ...fields(entry.operation), component, event }, message);
    } catch {
      // Diagnostic only.
    }
  }

  async function hook(name, run, entry) {
    try {
      await run(entry.operation);
    } catch (error) {
      log("warn", `${component}.${name}_hook_failed`, entry, { key: entry.key, error }, "A held work hook failed.");
    }
  }

  function start(key, work) {
    const entry = {
      key,
      operationId: crypto.randomUUID(),
      receivedAt: Date.now(),
      stage: "received",
      stages: { received: 0 },
      settled: false,
      outcome: null,
      heldAnswer: false
    };
    entry.operation = Object.freeze({
      operationId: entry.operationId,
      key,
      receivedAt: entry.receivedAt,
      get settled() { return entry.settled; },
      get waitingFor() { return entry.stage; },
      get stages() { return { ...entry.stages }; },
      get heldAnswer() { return entry.heldAnswer; },
      get elapsedMs() { return Date.now() - entry.receivedAt; },
      get result() { return entry.outcome?.result; },
      get error() { return entry.outcome?.error; }
    });
    const stage = (name) => {
      entry.stage = name;
      entry.stages[name] = Date.now() - entry.receivedAt;
    };
    entry.done = Promise.resolve()
      .then(() => work({ stage, signal: closing.signal }))
      .then(result => ({ result }), error => ({ error }))
      .then(async (outcome) => {
        entry.settled = true;
        entry.outcome = outcome;
        entry.stages.finished = Date.now() - entry.receivedAt;
        await hook("settled", settled, entry);
        const elapsedMs = Date.now() - entry.receivedAt;
        log(elapsedMs >= slowMs || entry.heldAnswer ? "warn" : "info", timingEvent, entry, {
          receivedAt: new Date(entry.receivedAt).toISOString(),
          elapsedMs,
          held: entry.heldAnswer,
          stages: entry.stages,
          outcome: outcome.error ? "failed" : "finished"
        }, "Held work timing, from its arrival.");
        const forget = setTimeout(() => {
          if (entries.get(key) === entry) entries.delete(key);
        }, outcomeMs);
        forget.unref();
        return outcome;
      });
    entries.set(key, entry);
    return entry;
  }

  /**
   * Runs the key's work, or joins it while it runs.
   * @template T
   * @param {string} key
   * @param {(controls: { stage: (name: string) => void, signal: AbortSignal }) => T | Promise<T>} work
   * @returns {Promise<{ settled: true, result: Awaited<T> } | { settled: false, operationId: string, waitingFor: string }>}
   */
  async function run(key, work) {
    const existing = entries.get(key);
    const entry = existing && !existing.settled ? existing : start(key, work);
    const answered = new AbortController();
    const outcome = await Promise.race([
      entry.done,
      delay(answerMs, null, { ref: false, signal: answered.signal }).catch(() => null)
    ]).finally(() => answered.abort());
    if (outcome) {
      if (outcome.error) throw outcome.error;
      return { settled: true, result: outcome.result };
    }
    if (!entry.heldAnswer) {
      entry.heldAnswer = true;
      await hook("held", held, entry);
      entry.stages.answered = Date.now() - entry.receivedAt;
      log("warn", heldEvent, entry, {
        waitingFor: entry.stage,
        elapsedMs: entry.stages.answered
      }, "Answered as held; the work goes on.");
    }
    return { settled: false, operationId: entry.operationId, waitingFor: entry.stage };
  }

  /**
   * The key's work, running or ended within `outcomeMs`, or null.
   * @param {string} key
   */
  function inspect(key) {
    return entries.get(key)?.operation || null;
  }

  /** At shutdown: aborts each running work's signal and resolves once every work has ended. */
  async function close() {
    closing.abort();
    await Promise.allSettled([...entries.values()].map(entry => entry.done));
  }

  return Object.freeze({
    close,
    inspect,
    run
  });
}

export { createHeldWork, HELD_ANSWER_MS, HELD_OUTCOME_MS };
