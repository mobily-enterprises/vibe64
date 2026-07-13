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
import {
  pendingComposerMessages
} from "./messageState.js";

const COMPOSER_DRAIN_OPERATION_NAMES = Object.freeze({
  controls: "composer-controls-drain",
  messages: "composer-messages-drain"
});

function positiveDelayMs(value = 0, fallback = 0) {
  const delay = Number(value);
  return Number.isFinite(delay) && delay > 0 ? delay : fallback;
}

function workflowDriverVibe64User(session = {}) {
  const username = normalizeText(session?.metadata?.workflow_driver_username);
  return username ? { username } : null;
}

async function runComposerSessionExclusive({
  ignoreMissingSession = false,
  operationName = "",
  runtime = null,
  session = null
} = {}, operation) {
  const runSessionExclusive = runtime?.store?.runSessionExclusive;
  if (typeof runSessionExclusive !== "function") {
    return {
      acquired: true,
      value: await operation()
    };
  }
  try {
    return await runSessionExclusive.call(
      runtime.store,
      session.sessionId,
      operationName,
      operation
    );
  } catch (error) {
    if (ignoreMissingSession && normalizeText(error?.code) === "vibe64_session_not_found") {
      return {
        acquired: true,
        sessionClosed: true,
        value: null
      };
    }
    throw error;
  }
}

function createComposerHandoffCoordinator({
  activate,
  deliver,
  drainControls = async () => null,
  drainMessages = async () => null,
  retryBaseDelayMs = 250,
  retryMaxDelayMs = 4_000
} = {}) {
  if (
    typeof activate !== "function" ||
    typeof deliver !== "function" ||
    typeof drainControls !== "function" ||
    typeof drainMessages !== "function"
  ) {
    throw new TypeError("Composer handoff coordinator requires activation, delivery, and queue-drain functions.");
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

  function drainOperation(kind = "", operation, {
    runtime = null,
    session = null
  } = {}) {
    const sessionId = normalizeText(session?.sessionId);
    if (!sessionId || !runtime) {
      throw new TypeError("Composer queue draining requires a runtime and session.");
    }
    const key = taskKey(kind, sessionId, "composer");
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
      const exclusive = await runComposerSessionExclusive({
        ignoreMissingSession: true,
        operationName: COMPOSER_DRAIN_OPERATION_NAMES[kind],
        runtime,
        session
      }, async () => {
        let operationResult = null;
        do {
          repeatedTasks.delete(key);
          operationResult = await operation({
            runtime,
            session
          });
        } while (repeatedTasks.delete(key));
        return operationResult;
      });
      const result = exclusive.acquired
        ? exclusive.value
        : {
            retry: true,
            waitingForExclusiveDelivery: true
          };
      if (result?.retry === true) {
        const attempt = (retryAttempts.get(key) || 0) + 1;
        retryAttempts.set(key, attempt);
        const delayMs = Math.min(
          maximumRetryDelay,
          baseRetryDelay * (2 ** Math.min(attempt - 1, 4))
        );
        const timer = setTimeout(() => {
          retryTimers.delete(key);
          void drainOperation(kind, operation, {
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

  function drainControlsForSession(input = {}) {
    return drainOperation("controls", drainControls, input);
  }

  function drainMessagesForSession(input = {}) {
    return drainOperation("messages", drainMessages, input);
  }

  function runMessagesExclusive({
    runtime = null,
    session = null
  } = {}, operation) {
    if (typeof operation !== "function") {
      throw new TypeError("Exclusive composer message work requires an operation.");
    }
    return runComposerSessionExclusive({
      operationName: COMPOSER_DRAIN_OPERATION_NAMES.messages,
      runtime,
      session
    }, operation);
  }

  async function drainSessionQueues(input = {}) {
    try {
      await drainControlsForSession(input);
    } finally {
      await drainMessagesForSession(input);
    }
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
      const exclusive = await runComposerSessionExclusive({
        ignoreMissingSession: true,
        operationName: "composer-handoff-delivery",
        runtime,
        session
      }, async () => {
        try {
          return await deliver({
            agentSettings,
            handoff,
            runtime,
            session,
            vibe64User
          });
        } finally {
          try {
            await drainControlsForSession({
              runtime,
              session
            });
          } finally {
            await drainMessagesForSession({
              runtime,
              session
            });
          }
        }
      });
      if (!exclusive.acquired) {
        return {
          retry: true,
          waitingForExclusiveDelivery: true
        };
      }
      return exclusive.value;
    });
  }

  function resume({
    runtime = null,
    session = null
  } = {}) {
    const state = composerHandoffSnapshot(session);
    if (!state) {
      return pendingComposerMessages(session).length
        ? drainMessagesForSession({ runtime, session })
        : null;
    }
    if (state.state === COMPOSER_HANDOFF_STATES.ACTIVE) {
      return drainSessionQueues({ runtime, session });
    }
    if (state.state === COMPOSER_HANDOFF_STATES.DELIVERED && state.threadId && state.turnId) {
      return startTask(taskKey("activation", session.sessionId, state.id), async () => {
        await activate({
          runtime,
          session,
          state
        });
        await drainSessionQueues({
          runtime,
          session
        });
      });
    }
    if (
      ![COMPOSER_HANDOFF_STATES.ACCEPTED, COMPOSER_HANDOFF_STATES.CONNECTING].includes(state.state) ||
      state.turnId
    ) {
      return pendingComposerMessages(session).length
        ? drainMessagesForSession({ runtime, session })
        : null;
    }
    const handoff = composerPromptHandoffForState(session, state.id);
    if (!handoff) {
      return pendingComposerMessages(session).length
        ? drainMessagesForSession({ runtime, session })
        : null;
    }
    const run = composerHandoffRun(session) || {};
    return schedule({
      agentSettings: run.agentSettings || null,
      handoff: state.submissionId
        ? {
            ...handoff,
            clientSubmissionId: state.submissionId,
            clientSubmissionIds: state.submissionIds
          }
        : handoff,
      runtime,
      session,
      vibe64User: workflowDriverVibe64User(session)
    });
  }

  return Object.freeze({
    drain: drainControlsForSession,
    drainMessages: drainMessagesForSession,
    resume,
    runMessagesExclusive,
    schedule
  });
}

export {
  createComposerHandoffCoordinator
};
