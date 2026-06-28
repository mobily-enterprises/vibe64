import { computed } from "vue";
import { useVibe64SessionActions } from "@/composables/useVibe64SessionActions.js";
import { useVibe64SessionClipboard } from "@/composables/useVibe64SessionClipboard.js";
import { useVibe64SessionCommandTerminal } from "@/composables/useVibe64SessionCommandTerminal.js";
import { useVibe64SessionDialogs } from "@/composables/useVibe64SessionDialogs.js";
import { useVibe64StepInputForm } from "@/composables/useVibe64StepInputForm.js";
import {
  commandMessage
} from "@/lib/vibe64SessionPanelModel.js";

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function codexTerminalSnapshot(session = {}) {
  const terminals = [
    objectValue(session?.codexTerminal),
    objectValue(session?.presentation?.terminal?.codex)
  ].filter(Boolean);
  const terminal = terminals.find((candidate) => (
    String(candidate.id || candidate.terminalSessionId || "").trim()
  )) || terminals[0] || {};
  return {
    status: String(terminal.status || "").trim(),
    terminalSessionId: String(terminal.id || terminal.terminalSessionId || "").trim()
  };
}

function codexTerminalUpdateBelongsToSession(payload = {}, session = {}) {
  const payloadSessionId = String(payload.sessionId || "").trim();
  const sessionId = String(session?.sessionId || "").trim();
  return !payloadSessionId || !sessionId || payloadSessionId === sessionId;
}

function codexTerminalUpdateNeedsSessionRefresh(payload = {}, session = {}) {
  if (!codexTerminalUpdateBelongsToSession(payload, session)) {
    return false;
  }

  const payloadTerminalId = String(payload.codexTerminalSessionId || payload.terminalSessionId || "").trim();
  if (!payloadTerminalId) {
    return false;
  }

  const snapshot = codexTerminalSnapshot(session);
  const payloadStatus = String(payload.codexTerminalStatus || payload.status || "").trim();
  if (!payloadStatus || payloadStatus === "running") {
    return false;
  }
  if (payloadStatus === "stale" || payloadStatus === "closed") {
    return true;
  }
  return Boolean(
    payloadTerminalId === snapshot.terminalSessionId &&
    payloadStatus !== snapshot.status
  );
}

function sessionUsesSeedWorkflow(session = {}) {
  const metadata = objectValue(session?.metadata) || {};
  const workflowId = String(
    session?.workflowId ||
      session?.workflowDefinition?.id ||
      metadata.workflow_definition ||
      ""
  ).trim();
  return workflowId === "seed_application" ||
    String(metadata.work_source || "").trim() === "seed";
}

function useVibe64SessionWorkflow({
  sessionData
} = {}) {
  const {
    clearSelectedSession,
    createSessionCommand,
    isSelectedSessionClosed,
    pageLoading,
    refreshSessionData,
    selectedSession,
    selectedSessionId,
    selectedSessionTitle,
    selectSessionId,
    sessionList,
    sessionsApiPath
  } = sessionData;

  const clipboard = useVibe64SessionClipboard();
  const workflow = {
    actions: null,
    commandTerminal: null,
    dialogs: null
  };

  const commandBusy = computed(() => Boolean(
    createSessionCommand.isRunning ||
    workflow.actions?.busy.value ||
    workflow.commandTerminal?.running.value ||
    workflow.dialogs?.busy.value
  ));

  const reviewDiffDisabled = computed(() => {
    return workflow.dialogs?.diff.loading.value ||
      sessionUsesSeedWorkflow(selectedSession.value || {}) ||
      !workflow.actions?.sourceReady.value;
  });
  const reviewDiffTitle = computed(() => {
    if (sessionUsesSeedWorkflow(selectedSession.value || {})) {
      return "Diff is disabled while seeding because the generated scaffold can be very large.";
    }
    if (!workflow.actions?.sourceReady.value) {
      return "Create the session clone before reviewing changes.";
    }
    return "Review changes in the session clone.";
  });

  function clearSessionTransientState() {
    workflow.actions?.clear();
    workflow.commandTerminal?.clear();
    workflow.dialogs?.clear();
  }

  workflow.commandTerminal = useVibe64SessionCommandTerminal({
    currentNext: () => workflow.actions?.currentNext.value,
    goNext: () => workflow.actions?.goNext(),
    refreshSessionData,
    selectedSession,
    selectedSessionId
  });

  workflow.actions = useVibe64SessionActions({
    clearCopyStatus: clipboard.clearCopyStatus,
    commandBusy: () => commandBusy.value,
    commandTerminal: workflow.commandTerminal,
    onRewindSuccess: clearSessionTransientState,
    openInputDialog: (action) => workflow.dialogs?.input.openDialog(action),
    refreshSessionData,
    selectedSession,
    selectedSessionId,
    sessionsApiPath
  });

  workflow.stepInput = useVibe64StepInputForm({
    onSaved: refreshSessionData,
    sessionsApiPath,
    session: selectedSession
  });

  workflow.dialogs = useVibe64SessionDialogs({
    activeActionId: workflow.actions.activeActionId,
    canOpenDiff: () => !reviewDiffDisabled.value,
    clearSelectedSession,
    commandBusy: () => commandBusy.value,
    isSelectedSessionClosed,
    onAbandoned: clearSessionTransientState,
    refreshSessionData,
    runActionCommand: workflow.actions.runActionCommand,
    selectedSessionId,
    selectedSessionTitle,
    sessionsApiPath
  });

  const pageError = computed(() => {
    return sessionList.loadError ||
      commandMessage(createSessionCommand, "error") ||
      workflow.actions.error.value ||
      commandMessage(workflow.dialogs.abandon.command, "error") ||
      "";
  });

  function selectSession(sessionId = "") {
    clearSessionTransientState();
    selectSessionId(sessionId);
  }

  function refreshSessionDataForCodexTerminalUpdate(payload = {}) {
    if (!codexTerminalUpdateNeedsSessionRefresh(payload, selectedSession.value || {})) {
      return null;
    }
    return refreshSessionData();
  }

  return {
    actions: {
      actionIcon: workflow.actions.actionIcon,
      actionResultMessage: workflow.actions.actionResultMessage,
      actionResultType: workflow.actions.actionResultType,
      activeActionId: workflow.actions.activeActionId,
      advanceSession: workflow.actions.advanceSession,
      advanceCommand: workflow.actions.advanceCommand,
      currentActions: workflow.actions.currentActions,
      currentNext: workflow.actions.currentNext,
      currentStepDisabledReason: workflow.actions.currentStepDisabledReason,
      goNext: workflow.actions.goNext,
      recoverStuckStep: workflow.actions.recoverStuckStep,
      recoverStuckStepCommand: workflow.actions.recoverStuckStepCommand,
      rewindToStep: workflow.actions.rewindToStep,
      runAction: workflow.actions.runAction,
      runActionById: workflow.actions.runActionById,
      runActionCommand: workflow.actions.runActionCommand,
      runIntent: workflow.actions.runIntent,
      runIntentById: workflow.actions.runIntentById,
      runIntentCommand: workflow.actions.runIntentCommand
    },
    codexTerminal: {
      sessionUpdate: refreshSessionDataForCodexTerminalUpdate
    },
    commandTerminal: {
      action: workflow.commandTerminal.action,
      closed: workflow.commandTerminal.closed,
      finished: workflow.commandTerminal.finished,
      input: workflow.commandTerminal.input,
      running: workflow.commandTerminal.running,
      runningChanged: workflow.commandTerminal.runningChanged,
      startKey: workflow.commandTerminal.startKey,
      visible: workflow.commandTerminal.visible
    },
    dialogs: {
      abandon: workflow.dialogs.abandon,
      diff: workflow.dialogs.diff,
      input: {
        close: workflow.dialogs.input.close,
        error: workflow.dialogs.input.error,
        fields: workflow.dialogs.input.fields,
        open: workflow.dialogs.input.open,
        saveDisabled: workflow.dialogs.input.saveDisabled,
        submit: workflow.dialogs.input.submit,
        submitting: workflow.dialogs.input.submitting,
        title: workflow.dialogs.input.title,
        values: workflow.dialogs.input.values
      }
    },
    page: {
      busy: commandBusy,
      copyStatus: clipboard.copyStatus,
      copyText: clipboard.copyText,
      error: pageError,
      loading: pageLoading
    },
    review: {
      acceptChangesUtilitiesVisible: workflow.actions.acceptChangesUtilitiesVisible,
      diffDisabled: reviewDiffDisabled,
      diffTitle: reviewDiffTitle
    },
    stepInput: workflow.stepInput,
    selectSession,
    timeline: {
      rewindCommand: workflow.actions.rewindCommand,
      rewindToStep: workflow.actions.rewindToStep
    }
  };
}

export {
  codexTerminalSnapshot,
  codexTerminalUpdateNeedsSessionRefresh,
  useVibe64SessionWorkflow
};
