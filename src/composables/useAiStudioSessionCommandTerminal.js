import { computed, nextTick, ref, unref } from "vue";
import {
  latestAiStudioActionResult
} from "@/lib/aiStudioActionResults.js";

function valueOf(value) {
  return typeof value === "function" ? value() : unref(value);
}

function useAiStudioSessionCommandTerminal({
  currentNext = () => null,
  goNext = async () => null,
  refreshSessionData,
  selectedSession,
  selectedSessionId
} = {}) {
  const action = ref(null);
  const input = ref({});
  const running = ref(false);
  const startKey = ref("");
  const pendingAdvanceOnSuccess = ref(false);
  const pendingStartedAt = ref(0);

  const visible = computed(() => Boolean(action.value || running.value));

  function clear() {
    action.value = null;
    input.value = {};
    running.value = false;
    startKey.value = "";
    pendingAdvanceOnSuccess.value = false;
    pendingStartedAt.value = 0;
  }

  function start(nextAction = {}) {
    const commandStartedAt = Date.now();
    action.value = nextAction;
    input.value = {};
    pendingAdvanceOnSuccess.value = nextAction.advanceOnSuccess === true;
    pendingStartedAt.value = commandStartedAt;
    startKey.value = `${unref(selectedSessionId)}:${nextAction.id}:${commandStartedAt}`;
  }

  async function refreshAfterSettled({
    actionId = "",
    exitCode = null
  } = {}) {
    running.value = false;
    await refreshSessionData();
    await nextTick();

    const result = latestAiStudioActionResult(valueOf(selectedSession), actionId, {
      since: pendingStartedAt.value
    });
    const commandSucceeded = Number(exitCode) === 0 || result?.status === "completed";
    const next = valueOf(currentNext);
    if (
      commandSucceeded &&
      pendingAdvanceOnSuccess.value &&
      next?.visible === true &&
      next?.enabled === true
    ) {
      clear();
      await goNext();
      return;
    }

    pendingAdvanceOnSuccess.value = false;
    pendingStartedAt.value = 0;
  }

  function handleClosed() {
    clear();
  }

  async function handleFinished(event = {}) {
    if (event.sessionId && event.sessionId !== unref(selectedSessionId)) {
      return;
    }
    await refreshAfterSettled({
      actionId: event.actionId,
      exitCode: event.exitCode
    });
  }

  async function handleRunningChanged(nextRunning) {
    const wasRunning = running.value;
    running.value = Boolean(nextRunning);
    if (running.value || !wasRunning) {
      return;
    }
    await refreshAfterSettled({
      actionId: action.value?.id || ""
    });
  }

  return {
    action,
    clear,
    closed: handleClosed,
    finished: handleFinished,
    input,
    running,
    runningChanged: handleRunningChanged,
    start,
    startKey,
    visible
  };
}

export {
  useAiStudioSessionCommandTerminal
};
