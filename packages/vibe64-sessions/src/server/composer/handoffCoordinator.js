import {
  COMPOSER_HANDOFF_STATES,
  composerHandoffId,
  composerHandoffRun,
  composerHandoffSnapshot,
  composerPromptHandoffForState
} from "./handoffState.js";
import {
  normalizeText
} from "@local/vibe64-core/server/core";

function positiveDelayMs(value = 0, fallback = 0) {
  const delay = Number(value);
  return Number.isFinite(delay) && delay > 0 ? delay : fallback;
}

function createComposerHandoffCoordinator({
  activate,
  deliver,
  drainControls = async () => null,
  retryBaseDelayMs = 250,
  retryMaxDelayMs = 4_000
} = {}) {
  if (
    typeof activate !== "function" ||
    typeof deliver !== "function" ||
    typeof drainControls !== "function"
  ) {
    throw new TypeError("Composer handoff coordinator requires activation, delivery, and control-drain functions.");
  }
  const baseRetryDelay = positiveDelayMs(retryBaseDelayMs, 250);
  const maximumRetryDelay = Math.max(
    baseRetryDelay,
    positiveDelayMs(retryMaxDelayMs, 4_000)
  );
  const tasks = new Map();
  const repeatedTasks = new Set();
  const retryAttempts = new Map();
  const retryTimers = new Map();

  function taskKey(kind = "", sessionId = "", handoffId = "") {
    return `${normalizeText(kind)}:${normalizeText(sessionId)}:${normalizeText(handoffId)}`;
  }

  function drain({
    runtime = null,
    session = null
  } = {}) {
    const sessionId = normalizeText(session?.sessionId);
    if (!sessionId || !runtime) {
      throw new TypeError("Composer control draining requires a runtime and session.");
    }
    const key = taskKey("controls", sessionId, "composer");
    const retryTimer = retryTimers.get(key);
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimers.delete(key);
    }
    const existing = tasks.get(key);
    if (existing) {
      repeatedTasks.add(key);
      return existing;
    }
    return startTask(key, async () => {
      let result = null;
      do {
        repeatedTasks.delete(key);
        result = await drainControls({
          runtime,
          session
        });
      } while (repeatedTasks.delete(key));
      if (result?.retry === true) {
        const attempt = (retryAttempts.get(key) || 0) + 1;
        retryAttempts.set(key, attempt);
        const delayMs = Math.min(
          maximumRetryDelay,
          baseRetryDelay * (2 ** Math.min(attempt - 1, 4))
        );
        const timer = setTimeout(() => {
          retryTimers.delete(key);
          void drain({
            runtime,
            session
          }).catch(() => {
            retryAttempts.delete(key);
          });
        }, delayMs);
        timer.unref?.();
        retryTimers.set(key, timer);
      } else {
        retryAttempts.delete(key);
      }
      return result;
    });
  }

  function startTask(key = "", operation) {
    const existing = tasks.get(key);
    if (existing) {
      return existing;
    }
    const task = Promise.resolve().then(operation);
    tasks.set(key, task);
    void task.catch(() => null).finally(() => {
      if (tasks.get(key) === task) {
        tasks.delete(key);
      }
    });
    return task;
  }

  function schedule({
    agentSettings = null,
    handoff = null,
    runtime = null,
    session = null,
    vibe64User = null
  } = {}) {
    const sessionId = normalizeText(session?.sessionId);
    const handoffId = composerHandoffId(handoff);
    if (!sessionId || !handoffId || !runtime) {
      throw new TypeError("Composer handoff scheduling requires a runtime, session, and persisted handoff.");
    }
    const key = taskKey("delivery", sessionId, handoffId);
    return startTask(key, async () => {
      const result = await deliver({
        agentSettings,
        handoff,
        runtime,
        session,
        vibe64User
      });
      await drain({
        runtime,
        session
      });
      return result;
    });
  }

  function resume({
    runtime = null,
    session = null
  } = {}) {
    const state = composerHandoffSnapshot(session);
    if (!state) {
      return null;
    }
    if (state.state === COMPOSER_HANDOFF_STATES.ACTIVE) {
      return drain({
        runtime,
        session
      });
    }
    if (state.state === COMPOSER_HANDOFF_STATES.DELIVERED && state.threadId && state.turnId) {
      return startTask(taskKey("activation", session.sessionId, state.id), async () => {
        await activate({
          runtime,
          session,
          state
        });
        await drain({
          runtime,
          session
        });
      });
    }
    if (
      ![COMPOSER_HANDOFF_STATES.ACCEPTED, COMPOSER_HANDOFF_STATES.CONNECTING].includes(state.state) ||
      state.turnId
    ) {
      return null;
    }
    const handoff = composerPromptHandoffForState(session, state.id);
    if (!handoff) {
      return null;
    }
    const run = composerHandoffRun(session) || {};
    return schedule({
      agentSettings: run.agentSettings || null,
      handoff,
      runtime,
      session
    });
  }

  return Object.freeze({
    drain,
    resume,
    schedule
  });
}

export {
  createComposerHandoffCoordinator
};
