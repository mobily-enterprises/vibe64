import { computed, ref, shallowRef, toValue, watch } from "vue";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { AI_TASK_MESSAGES as WORDS } from "./aiTaskMessages.js";

/** @typedef {import("./types.js").AiTask} AiTask */

const SESSION_CHANGED_EVENT = "vibe64.session.changed";
const AI_TASK_CHANGED = "ai-task-changed";

/**
 * The session's AI task, as its server and its viewers say it is. There is at most one, and only
 * the server moves it: every action here asks, then shows the answer.
 * @param {object} options
 * @param {import("vue").MaybeRefOrGetter<string>} options.sessionId
 * @param {import("vue").MaybeRefOrGetter<string>} options.sessionsApiPath
 * @param {import("vue").MaybeRefOrGetter<string>} options.projectSlug
 * @param {import("vue").MaybeRefOrGetter<boolean>} options.enabled
 * @param {(path: string, options: object) => Promise<object>} options.request throws what the server refused
 * @param {(closed: AiTask) => void} options.onClosed when another page closed the task
 */
function useAiTasks({ sessionId, sessionsApiPath, projectSlug, enabled, request, onClosed }) {
  /** @type {import("vue").ShallowRef<AiTask | null>} */
  const task = shallowRef(null);
  const loaded = ref(false);
  const error = ref("");
  const cancelRequested = ref(false);
  const closing = ref(false);
  const starting = ref(false);
  const viewerId = ref("");
  let readGeneration = 0;

  const tasksPath = () => `${toValue(sessionsApiPath)}/${encodeURIComponent(toValue(sessionId))}/ai-tasks`;
  const taskPath = (suffix = "") => `${tasksPath()}/${encodeURIComponent(task.value.id)}${suffix}`;

  /**
   * Keeps what the server said last, whichever answer arrives first.
   * @param {AiTask} next
   */
  function remember(next) {
    if (task.value?.id === next.id && next.revision < task.value.revision) return;
    task.value = next;
  }

  async function load() {
    const generation = ++readGeneration;
    if (!toValue(enabled) || !toValue(sessionId)) return;
    try {
      const { tasks, viewerId: viewer } = await request(tasksPath(), { method: "GET" });
      if (generation !== readGeneration) return;
      viewerId.value = viewer;
      const [saved = null] = tasks;
      if (saved) remember(saved);
      else task.value = null;
      loaded.value = true;
    } catch {
      // The next realtime notice or reconnection reads it again; nothing here is lost.
    }
  }

  /**
   * @param {string} kind
   * @param {object} input
   * @returns {Promise<AiTask | null>}
   */
  async function start(kind, input) {
    error.value = "";
    starting.value = true;
    try {
      const answer = await request(tasksPath(), { method: "POST", body: { kind, input } });
      remember(answer.task);
      return answer.task;
    } catch (failure) {
      error.value = failure.message || WORDS.requestFailed;
      return null;
    } finally {
      starting.value = false;
    }
  }

  /**
   * @param {string} suffix
   * @param {object} [body]
   */
  async function act(suffix, body = {}) {
    error.value = "";
    try {
      const answer = await request(taskPath(suffix), { method: "POST", body });
      remember(answer.task);
    } catch (failure) {
      error.value = failure.message || WORDS.requestFailed;
      void load();
    }
  }

  // Cancel means cancel. The button says Cancelling… until the server answers and can always be
  // pressed again; the task stays on screen until the server says it has ended.
  async function cancel() {
    cancelRequested.value = true;
    await act("/cancel");
    cancelRequested.value = false;
  }

  /** @param {{ reviewedConflictId?: string }} [input] */
  const check = (input = {}) => act("/check", input);
  const continueTask = () => act("/continue");
  const finish = () => act("/finish");

  async function close() {
    error.value = "";
    closing.value = true;
    try {
      await request(taskPath(), { method: "DELETE" });
      task.value = null;
    } catch {
      error.value = WORDS.closeFailed;
    } finally {
      closing.value = false;
    }
  }

  const matchesSession = payload => payload.projectSlug === toValue(projectSlug) &&
    payload.sessionId === toValue(sessionId) && payload.reason === AI_TASK_CHANGED;

  useRealtimeEvent({
    enabled: computed(() => toValue(enabled)),
    event: SESSION_CHANGED_EVENT,
    matches: ({ payload = {} } = {}) => matchesSession(payload),
    onEvent({ payload }) {
      if (payload.aiTask) {
        remember(payload.aiTask);
        return;
      }
      if (payload.aiTaskClosed?.id !== task.value?.id) return;
      const closedHere = closing.value;
      task.value = null;
      if (!closedHere) onClosed(payload.aiTaskClosed);
    }
  });
  // What changed while this page was disconnected reached nobody; the saved record is the answer.
  useRealtimeEvent({ enabled: computed(() => toValue(enabled)), event: "connect", onEvent: () => void load() });

  watch(() => [toValue(sessionId), toValue(enabled)], ([, on], previous) => {
    if (previous?.[0] !== toValue(sessionId)) {
      task.value = null;
      loaded.value = false;
    }
    if (on) void load();
  }, { immediate: true });

  return {
    cancel,
    cancelRequested,
    check,
    close,
    closing,
    continueTask,
    error,
    finish,
    load,
    loaded,
    start,
    starting,
    task,
    viewerId
  };
}

export { useAiTasks };
