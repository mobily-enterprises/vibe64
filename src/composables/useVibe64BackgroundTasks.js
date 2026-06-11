import { computed, ref, unref } from "vue";

import {
  clientControlHasDispatcher,
} from "@/lib/vibe64ClientControlDispatcher.js";
import {
  useVibe64ClientControls
} from "@/composables/useVibe64ClientControls.js";
import {
  VIBE64_CODEX_APP_SERVER_TASK_ID
} from "@/lib/vibe64CodexTerminalAttention.js";

const VISIBLE_BACKGROUND_TASK_STATUSES = new Set(["failed", "running"]);

function normalizeBackgroundTasks(session = {}) {
  return (Array.isArray(session?.presentation?.backgroundTasks) ? session.presentation.backgroundTasks : [])
    .filter((task) => task && typeof task === "object")
    .map((task) => ({
      ...task,
      error: String(task.error || "").trim(),
      id: String(task.id || "").trim(),
      label: String(task.label || task.id || "Background task").trim(),
      message: String(task.message || "").trim(),
      retry: task.retry && typeof task.retry === "object" ? task.retry : null,
      status: String(task.status || "").trim(),
      updatedAt: String(task.updatedAt || "").trim()
    }))
    .filter((task) => task.id && task.status);
}

function taskRetryHasClientDispatcher(task = {}) {
  return clientControlHasDispatcher(task.retry);
}

function taskRetryErrorMessage(error) {
  return String(error?.message || error || "Background task retry failed.").trim();
}

function taskNeedsCodexTerminalRecovery(task = {}) {
  return String(task?.id || "").trim() === VIBE64_CODEX_APP_SERVER_TASK_ID;
}

function useVibe64BackgroundTasks({
  openCodexTerminal = null,
  refreshSessionData = async () => null,
  runClientControl = null,
  sessionsApiPath = null,
  session
} = {}) {
  const customRunClientControl = typeof runClientControl === "function" ? runClientControl : null;
  const clientControls = customRunClientControl ? null : useVibe64ClientControls({
    sessionsApiPath
  });
  const retryingBackgroundTaskId = ref("");
  const backgroundTaskError = ref("");
  const backgroundTasks = computed(() => normalizeBackgroundTasks(unref(session) || {}));
  const visibleBackgroundTasks = computed(() => backgroundTasks.value.filter((task) => {
    return VISIBLE_BACKGROUND_TASK_STATUSES.has(task.status);
  }));

  async function retryBackgroundTask(task = {}) {
    const sessionId = String(unref(session)?.sessionId || "").trim();
    if (!sessionId || !task.id || !taskRetryHasClientDispatcher(task)) {
      return false;
    }
    backgroundTaskError.value = "";
    retryingBackgroundTaskId.value = task.id;
    try {
      const result = await (customRunClientControl || clientControls.runClientControl)(task.retry, {
        refreshSessionData,
        session: unref(session),
        sessionId
      });
      if (!result) {
        return false;
      }
      if (result?.ok === false) {
        throw new Error(result.error || "Codex could not be prepared.");
      }
      return true;
    } catch (error) {
      await openCodexTerminalForTask(task);
      backgroundTaskError.value = taskRetryErrorMessage(error);
      return false;
    } finally {
      retryingBackgroundTaskId.value = "";
    }
  }

  async function openCodexTerminalForTask(task = {}) {
    if (!taskNeedsCodexTerminalRecovery(task) || typeof openCodexTerminal !== "function") {
      return false;
    }
    return await openCodexTerminal({
      source: "background_task",
      task
    });
  }

  return {
    backgroundTaskError,
    backgroundTasks,
    retryBackgroundTask,
    retryingBackgroundTaskId,
    visibleBackgroundTasks
  };
}

export {
  normalizeBackgroundTasks,
  useVibe64BackgroundTasks
};
