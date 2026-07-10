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

function createComposerHandoffCoordinator({
  activate,
  deliver
} = {}) {
  if (typeof activate !== "function" || typeof deliver !== "function") {
    throw new TypeError("Composer handoff coordinator requires activation and delivery functions.");
  }
  const tasks = new Map();

  function taskKey(sessionId = "", handoffId = "") {
    return `${normalizeText(sessionId)}:${normalizeText(handoffId)}`;
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
    const key = taskKey(sessionId, handoffId);
    return startTask(key, () => deliver({
      agentSettings,
      handoff,
      runtime,
      session,
      vibe64User
    }));
  }

  function resume({
    runtime = null,
    session = null
  } = {}) {
    const state = composerHandoffSnapshot(session);
    if (!state) {
      return null;
    }
    if (state.state === COMPOSER_HANDOFF_STATES.DELIVERED && state.threadId && state.turnId) {
      return startTask(taskKey(session.sessionId, state.id), () => activate({
        runtime,
        session,
        state
      }));
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
    resume,
    schedule
  });
}

export {
  createComposerHandoffCoordinator
};
