import { computed } from "vue";
import { useAiStudioSessionActions } from "@/composables/useAiStudioSessionActions.js";
import { useAiStudioSessionClipboard } from "@/composables/useAiStudioSessionClipboard.js";
import { useAiStudioSessionCodexHandoff } from "@/composables/useAiStudioSessionCodexHandoff.js";
import { useAiStudioSessionCommandTerminal } from "@/composables/useAiStudioSessionCommandTerminal.js";
import { useAiStudioSessionDialogs } from "@/composables/useAiStudioSessionDialogs.js";
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
    codexHandoff: null,
    commandTerminal: null,
    dialogs: null
  };

  const commandBusy = computed(() => Boolean(
    createSessionCommand.isRunning ||
    workflow.actions?.busy.value ||
    workflow.codexHandoff?.busy.value ||
    workflow.commandTerminal?.running.value ||
    workflow.dialogs?.busy.value
  ));

  const reviewDiffDisabled = computed(() => {
    return commandBusy.value ||
      workflow.dialogs?.diff.loading.value ||
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
    workflow.codexHandoff?.clear();
    workflow.commandTerminal?.clear();
    workflow.dialogs?.clear();
  }

  workflow.codexHandoff = useAiStudioSessionCodexHandoff({
    refreshSessionData,
    selectedSessionId,
    setCopyStatus: clipboard.setCopyStatus,
    waitingForPromptedArtifact: () => workflow.actions?.waitingForPromptedArtifact.value
  });

  workflow.commandTerminal = useAiStudioSessionCommandTerminal({
    currentNext: () => workflow.actions?.currentNext.value,
    goNext: () => workflow.actions?.goNext(),
    refreshSessionData,
    selectedSession,
    selectedSessionId
  });

  workflow.actions = useAiStudioSessionActions({
    clearCopyStatus: clipboard.clearCopyStatus,
    codexHandoff: workflow.codexHandoff,
    commandBusy: () => commandBusy.value,
    commandTerminal: workflow.commandTerminal,
    onRewindSuccess: clearSessionTransientState,
    openDraftEditor: (action) => workflow.dialogs?.draftEditor.openDialog(action),
    openInputDialog: (action) => workflow.dialogs?.input.openDialog(action),
    refreshSessionData,
    selectedSession,
    selectedSessionId,
    sessionsApiPath
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
    sessionsApiPath,
    setCopyStatus: clipboard.setCopyStatus
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
      runAction: workflow.actions.runAction,
      runActionCommand: workflow.actions.runActionCommand
    },
    codexTerminal: {
      busyChanged: workflow.codexHandoff.busyChanged,
      promptInjected: workflow.codexHandoff.promptInjected,
      promptInjectionFailed: workflow.codexHandoff.promptInjectionFailed,
      promptInjectionKey: workflow.codexHandoff.promptInjectionKey,
      promptOverride: workflow.codexHandoff.promptOverride,
      sessionUpdate: workflow.codexHandoff.sessionUpdate
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
      draftEditor: {
        error: workflow.dialogs.draftEditor.error,
        fields: workflow.dialogs.draftEditor.fields,
        loading: workflow.dialogs.draftEditor.loading,
        open: workflow.dialogs.draftEditor.open,
        save: workflow.dialogs.draftEditor.save,
        saving: workflow.dialogs.draftEditor.saving,
        title: workflow.dialogs.draftEditor.title,
        values: workflow.dialogs.draftEditor.values
      },
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
    issueRequest: workflow.actions.issueRequest,
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
