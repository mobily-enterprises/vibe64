import { computed } from "vue";
import { useAiStudioSessionActions } from "@/composables/useAiStudioSessionActions.js";
import { useAiStudioSessionClipboard } from "@/composables/useAiStudioSessionClipboard.js";
import { useAiStudioSessionCommandTerminal } from "@/composables/useAiStudioSessionCommandTerminal.js";
import { useAiStudioSessionDialogs } from "@/composables/useAiStudioSessionDialogs.js";
import { useAiStudioStepInputForm } from "@/composables/useAiStudioStepInputForm.js";
import {
  commandMessage
} from "@/lib/aiStudioSessionPanelModel.js";

function useAiStudioSessionWorkflow({
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

  const clipboard = useAiStudioSessionClipboard();
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
      !workflow.actions?.worktreeReady.value;
  });
  const reviewDiffTitle = computed(() => {
    if (!workflow.actions?.worktreeReady.value) {
      return "Create the worktree before reviewing changes.";
    }
    return "Review changes in the session worktree.";
  });

  function clearSessionTransientState() {
    workflow.actions?.clear();
    workflow.commandTerminal?.clear();
    workflow.dialogs?.clear();
  }

  workflow.commandTerminal = useAiStudioSessionCommandTerminal({
    currentNext: () => workflow.actions?.currentNext.value,
    goNext: () => workflow.actions?.goNext(),
    refreshSessionData,
    selectedSession,
    selectedSessionId
  });

  workflow.actions = useAiStudioSessionActions({
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

  workflow.stepInput = useAiStudioStepInputForm({
    onSaved: refreshSessionData,
    session: selectedSession
  });

  workflow.dialogs = useAiStudioSessionDialogs({
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

  return {
    actions: {
      actionIcon: workflow.actions.actionIcon,
      actionResultMessage: workflow.actions.actionResultMessage,
      actionResultType: workflow.actions.actionResultType,
      activeActionId: workflow.actions.activeActionId,
      advanceCommand: workflow.actions.advanceCommand,
      currentActions: workflow.actions.currentActions,
      currentNext: workflow.actions.currentNext,
      currentStepDisabledReason: workflow.actions.currentStepDisabledReason,
      goNext: workflow.actions.goNext,
      rewindToStep: workflow.actions.rewindToStep,
      runAction: workflow.actions.runAction,
      runActionCommand: workflow.actions.runActionCommand,
      runIntent: workflow.actions.runIntent,
      runIntentCommand: workflow.actions.runIntentCommand
    },
    codexTerminal: {
      sessionUpdate: refreshSessionData
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
  useAiStudioSessionWorkflow
};
