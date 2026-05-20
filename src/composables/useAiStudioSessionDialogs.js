import { computed, ref, unref } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import {
  useAiStudioDiffDialog
} from "@/composables/useAiStudioDiffDialog.js";
import {
  useAiStudioDraftEditor
} from "@/composables/useAiStudioDraftEditor.js";
import { useAiStudioSessionArtifacts } from "@/composables/useAiStudioSessionArtifacts.js";
import {
  emptyActionInputValues,
  normalizeActionInputFields,
  requiredActionInputMissing
} from "@/lib/aiStudioActionInputModel.js";
import {
  AI_STUDIO_SESSIONS_API_SUFFIX,
  AI_STUDIO_SURFACE_ID,
  LOCAL_STUDIO_COMMAND_OPTIONS,
  aiStudioSessionPath
} from "@/lib/aiStudioSessionRequestConfig.js";
import {
  readRefOrGetterBoolean
} from "@/lib/vueRefOrGetterValue.js";

function useAiStudioSessionDialogs({
  activeActionId,
  canOpenDiff = () => false,
  clearSelectedSession,
  commandBusy = () => false,
  isSelectedSessionClosed,
  onAbandoned = () => null,
  refreshSessionData,
  runActionCommand,
  selectedSessionId,
  selectedSessionTitle,
  sessionsApiPath,
  setCopyStatus = () => null
} = {}) {
  const abandonDialogOpen = ref(false);
  const abandonDialogSessionId = ref("");
  const abandonDialogSessionTitle = ref("");
  const inputDialogAction = ref(null);
  const inputDialogError = ref("");
  const inputDialogOpen = ref(false);
  const inputDialogSubmitting = ref(false);
  const inputDialogValues = ref({});
  const sessionArtifacts = useAiStudioSessionArtifacts();

  const {
    clearDiffDialog,
    closeDiffDialog,
    diffDialogOpen,
    diffError,
    diffLoading,
    diffPayload,
    openDiffDialog
  } = useAiStudioDiffDialog({
    canOpen: canOpenDiff,
    selectedSessionId
  });

  const {
    clear: clearDraftEditor,
    draftEditorError,
    draftEditorFields,
    draftEditorLoading,
    draftEditorOpen,
    draftEditorSaving,
    draftEditorTitle,
    draftEditorValues,
    openDraftEditor,
    saveDraftEditor
  } = useAiStudioDraftEditor({
    onSaved() {
      setCopyStatus("Draft saved.");
    },
    refreshSessionData,
    selectedSessionId,
    sessionArtifacts
  });

  const abandonCommand = useCommand({
    access: "never",
    apiSuffix: AI_STUDIO_SESSIONS_API_SUFFIX,
    buildCommandOptions: (_payload, { context }) => ({
      method: "POST",
      options: LOCAL_STUDIO_COMMAND_OPTIONS,
      path: aiStudioSessionPath(sessionsApiPath.value, context?.sessionId, "/abandon")
    }),
    fallbackRunError: "AI Studio session could not be abandoned.",
    messages: {
      error: "AI Studio session could not be abandoned.",
      success: "AI Studio session abandoned."
    },
    onRunSuccess: async (_response, { context } = {}) => {
      if (!context?.sessionId || context.sessionId === unref(selectedSessionId)) {
        clearSelectedSession();
      }
      onAbandoned();
      await refreshSessionData();
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "ai-studio.sessions.abandon",
    surfaceId: AI_STUDIO_SURFACE_ID,
    writeMethod: "POST"
  });

  const inputDialogFields = computed(() => normalizeActionInputFields(inputDialogAction.value?.inputFields));
  const inputDialogTitle = computed(() => String(inputDialogAction.value?.label || "Provide details"));
  const inputDialogSaveDisabled = computed(() => {
    if (inputDialogSubmitting.value || readRefOrGetterBoolean(commandBusy) || inputDialogFields.value.length < 1) {
      return true;
    }
    return requiredActionInputMissing(inputDialogFields.value, inputDialogValues.value);
  });
  const busy = computed(() => Boolean(
    abandonCommand.isRunning ||
    draftEditorLoading.value ||
    draftEditorSaving.value ||
    inputDialogSubmitting.value
  ));

  function clearAbandonDialog() {
    abandonDialogOpen.value = false;
    abandonDialogSessionId.value = "";
    abandonDialogSessionTitle.value = "";
  }

  function requestAbandonSelectedSession() {
    if (!unref(selectedSessionId) || abandonCommand.isRunning || unref(isSelectedSessionClosed)) {
      return;
    }
    abandonDialogSessionId.value = unref(selectedSessionId);
    abandonDialogSessionTitle.value = unref(selectedSessionTitle);
    abandonDialogOpen.value = true;
  }

  function cancelAbandonSession() {
    if (abandonCommand.isRunning) {
      return;
    }
    clearAbandonDialog();
  }

  async function confirmAbandonSession() {
    if (!abandonDialogSessionId.value || abandonCommand.isRunning) {
      return;
    }
    await abandonCommand.run({
      sessionId: abandonDialogSessionId.value
    });
  }

  function openInputDialog(action = {}) {
    const fields = normalizeActionInputFields(action.inputFields);
    inputDialogAction.value = action;
    inputDialogError.value = "";
    inputDialogValues.value = emptyActionInputValues(fields);
    inputDialogOpen.value = true;
  }

  function closeInputDialog() {
    if (inputDialogSubmitting.value) {
      return;
    }
    inputDialogAction.value = null;
    inputDialogError.value = "";
    inputDialogOpen.value = false;
    inputDialogValues.value = {};
  }

  async function submitInputDialog() {
    const action = inputDialogAction.value;
    if (!unref(selectedSessionId) || !action?.id || inputDialogSaveDisabled.value) {
      return;
    }
    inputDialogError.value = "";
    inputDialogSubmitting.value = true;
    activeActionId.value = action.id;
    try {
      await runActionCommand.run({
        actionId: action.id,
        advanceOnSuccess: action.advanceOnSuccess === true,
        input: {
          ...inputDialogValues.value
        },
        sessionId: unref(selectedSessionId)
      });
      inputDialogOpen.value = false;
      inputDialogAction.value = null;
      inputDialogValues.value = {};
    } catch (error) {
      inputDialogError.value = String(error?.message || error || "Action failed.");
    } finally {
      inputDialogSubmitting.value = false;
      activeActionId.value = "";
    }
  }

  function clearInputDialog() {
    inputDialogAction.value = null;
    inputDialogError.value = "";
    inputDialogOpen.value = false;
    inputDialogSubmitting.value = false;
    inputDialogValues.value = {};
  }

  function clear() {
    clearAbandonDialog();
    clearDiffDialog();
    clearDraftEditor();
    clearInputDialog();
  }

  return {
    abandon: {
      cancel: cancelAbandonSession,
      command: abandonCommand,
      confirm: confirmAbandonSession,
      open: abandonDialogOpen,
      request: requestAbandonSelectedSession,
      sessionId: abandonDialogSessionId,
      sessionTitle: abandonDialogSessionTitle
    },
    busy,
    clear,
    diff: {
      close: closeDiffDialog,
      error: diffError,
      loading: diffLoading,
      open: diffDialogOpen,
      openDialog: openDiffDialog,
      payload: diffPayload
    },
    draftEditor: {
      error: draftEditorError,
      fields: draftEditorFields,
      loading: draftEditorLoading,
      open: draftEditorOpen,
      openDialog: openDraftEditor,
      save: saveDraftEditor,
      saving: draftEditorSaving,
      title: draftEditorTitle,
      values: draftEditorValues
    },
    input: {
      close: closeInputDialog,
      error: inputDialogError,
      fields: inputDialogFields,
      open: inputDialogOpen,
      openDialog: openInputDialog,
      saveDisabled: inputDialogSaveDisabled,
      submit: submitInputDialog,
      submitting: inputDialogSubmitting,
      title: inputDialogTitle,
      values: inputDialogValues
    }
  };
}

export {
  useAiStudioSessionDialogs
};
