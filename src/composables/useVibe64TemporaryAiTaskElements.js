import { nextTick } from "vue";
import { hasWindowFunction } from "@/lib/browser.js";

/** Resolves after the browser paints the next frame; outside a browser, at once. */
function afterBrowserPaint() {
  if (!hasWindowFunction("requestAnimationFrame")) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    globalThis.requestAnimationFrame(() => resolve());
  });
}

/** Keeps one task's element while it is mounted, and forgets it once it is removed. */
function rememberTaskElement(elements, taskId = "", element = null) {
  const normalizedTaskId = String(taskId || "");
  if (!normalizedTaskId) {
    return;
  }
  if (element) {
    elements.set(normalizedTaskId, element);
    return;
  }
  elements.delete(normalizedTaskId);
}

/**
 * The temporary AI workspace's per-task elements (tab button, prompt and send
 * button), and the reveal and focus moves made with them.
 * @param {object} options
 * @param {import("vue").Ref<HTMLElement | null>} options.workspace the workspace's own element, focused when a tab is not
 * @param {import("vue").Ref<{ id: string } | null>} options.activeTask
 */
function useVibe64TemporaryAiTaskElements({ workspace, activeTask }) {
  const taskTabButtons = new Map();
  const taskPrompts = new Map();
  const taskSendButtons = new Map();

  function taskPrompt(taskId = "") {
    return taskPrompts.get(String(taskId || "")) || null;
  }

  async function revealTaskTab(taskId = "", { focus = false } = {}) {
    const normalizedTaskId = String(taskId || "");
    if (!normalizedTaskId) {
      return false;
    }
    await nextTick();
    await afterBrowserPaint();
    const button = taskTabButtons.get(normalizedTaskId);
    button?.scrollIntoView({
      block: "nearest",
      inline: "nearest"
    });
    if (focus) {
      const target = button || workspace.value;
      target?.focus({ preventScroll: true });
    }
    return Boolean(button);
  }

  function focusSendButton() {
    const sendButton = taskSendButtons.get(activeTask.value?.id);
    sendButton?.focus();
  }

  return {
    focusSendButton,
    revealTaskTab,
    setTaskPrompt: (taskId, element) => rememberTaskElement(taskPrompts, taskId, element),
    setTaskSendButton: (taskId, element) => rememberTaskElement(taskSendButtons, taskId, element),
    setTaskTabButton: (taskId, element) => rememberTaskElement(taskTabButtons, taskId, element),
    taskPrompt
  };
}

export { useVibe64TemporaryAiTaskElements };
