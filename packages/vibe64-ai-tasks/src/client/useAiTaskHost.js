import { computed, nextTick, reactive, ref, toValue, watch } from "vue";
import { aiTaskEnded } from "../shared/aiTaskPhases.js";
import { AI_TASK_MESSAGES as WORDS } from "./aiTaskMessages.js";
import { AI_TASK_ACTIONS, projectAiTask } from "./aiTaskProjection.js";
import { useAiTasks } from "./useAiTasks.js";
import { useAiTaskWindow } from "./useAiTaskWindow.js";

/** @typedef {ReturnType<typeof useAiTaskHost>} AiTaskHost */

/**
 * One session's AI task for its page: the task, its window and what a person can do from it. The
 * app supplies what only it knows, so nothing here reaches for the app or its host.
 * @param {object} options
 * @param {import("vue").MaybeRefOrGetter<string>} options.sessionId
 * @param {import("vue").MaybeRefOrGetter<string>} options.sessionsApiPath
 * @param {import("vue").MaybeRefOrGetter<string>} options.projectSlug
 * @param {import("vue").MaybeRefOrGetter<boolean>} options.enabled whether this session has tasks at all
 * @param {import("vue").MaybeRefOrGetter<boolean>} options.active whether this session is the one on screen
 * @param {(path: string, options: object) => Promise<object>} options.request
 * @param {import("vue-router").RouteLocationNormalizedLoaded} options.route
 * @param {import("vue-router").Router} options.router
 * @param {() => void} options.openAiSetup
 * @param {() => void} options.reviewResolved
 * @param {() => HTMLElement | null} options.fallbackFocus where focus goes when opener and tray have gone
 */
function useAiTaskHost({
  sessionId, sessionsApiPath, projectSlug, enabled, active, request, route, router,
  openAiSetup, reviewResolved, fallbackFocus
}) {
  const toast = ref(null);
  const tasks = useAiTasks({
    sessionId,
    sessionsApiPath,
    projectSlug,
    enabled,
    request,
    onClosed(closed) {
      const heading = closed.phase === "done" ? WORDS.outcome.done : WORDS.outcome.notDone;
      toast.value = { text: WORDS.toast(closed.title, heading), action: false };
    }
  });
  const projection = computed(() => tasks.task.value && projectAiTask(tasks.task.value, { viewerId: tasks.viewerId.value }));
  const taskWindow = useAiTaskWindow({
    task: tasks.task,
    loaded: tasks.loaded,
    active,
    opensOn: () => projection.value?.opensOn || "progress",
    route,
    router
  });

  function returnFocusTarget() {
    return taskWindow.opener() || document.querySelector("[data-vibe64-ai-task-tray]") || fallbackFocus();
  }

  /**
   * @param {string} kind
   * @param {HTMLElement | null} opener what focus returns to; a request from a dialog that closed has none
   * @param {object} input what only the page knows about the problem, such as a failed sign-in
   * @returns {Promise<object | null>} the task, or null when it was refused, so a form can stay open
   */
  async function start(kind, opener, input) {
    const task = await tasks.start(kind, input);
    if (task) await nextTick();
    if (task) taskWindow.show(opener);
    else toast.value = { text: tasks.error.value, action: false };
    return task;
  }

  async function close() {
    const target = returnFocusTarget();
    await tasks.close();
    if (tasks.task.value) return;
    taskWindow.hide();
    await nextTick();
    (target?.isConnected ? target : fallbackFocus())?.focus({ preventScroll: true });
  }

  /** @param {string} actionId */
  function run(actionId) {
    const { task } = tasks;
    if (actionId === AI_TASK_ACTIONS.ANSWER || actionId === AI_TASK_ACTIONS.OPEN_CHAT) taskWindow.setView("chat");
    else if (actionId === AI_TASK_ACTIONS.CHECK) void tasks.check();
    else if (actionId === AI_TASK_ACTIONS.CONTINUE) void tasks.continueTask();
    else if (actionId === AI_TASK_ACTIONS.FINISH) void tasks.finish();
    else if (actionId === AI_TASK_ACTIONS.END) void tasks.cancel();
    else if (actionId === AI_TASK_ACTIONS.AI_SETUP) openAiSetup();
    else if (actionId === AI_TASK_ACTIONS.REVIEW && task.value) reviewResolved();
  }

  function seeToastResult() {
    toast.value = null;
    taskWindow.show(null);
  }

  // A task that ends while nobody is looking says so; the window never opens by itself.
  watch(() => tasks.task.value && aiTaskEnded(tasks.task.value), (ended, wasEnded) => {
    if (!ended || wasEnded !== false || taskWindow.open.value || !toValue(active)) return;
    toast.value = { text: WORDS.toast(tasks.task.value.title, projection.value.outcome.heading), action: true };
  });

  return reactive({
    cancel: tasks.cancel,
    cancelRequested: tasks.cancelRequested,
    check: tasks.check,
    close,
    closing: tasks.closing,
    error: tasks.error,
    hide: taskWindow.hide,
    open: taskWindow.open,
    projection,
    rename: tasks.rename,
    returnFocusTarget,
    run,
    seeToastResult,
    setTranscript: (open) => { taskWindow.transcriptOpen.value = open; },
    setView: taskWindow.setView,
    show: taskWindow.show,
    start,
    starting: tasks.starting,
    task: tasks.task,
    toast,
    transcriptOpen: taskWindow.transcriptOpen,
    view: taskWindow.view
  });
}

export { useAiTaskHost };
