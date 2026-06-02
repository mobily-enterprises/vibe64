import { computed, ref, unref } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import {
  useVibe64DiffDialog
} from "@/composables/useVibe64DiffDialog.js";
import {
  emptyActionInputValues,
  normalizeActionInputFields,
  requiredActionInputMissing
} from "@/lib/vibe64ActionInputModel.js";
import {
  VIBE64_SESSIONS_API_SUFFIX,
  VIBE64_SURFACE_ID,
  LOCAL_STUDIO_COMMAND_OPTIONS,
  vibe64SessionPath
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  readRefOrGetterBoolean
} from "@/lib/vueRefOrGetterValue.js";

function useVibe64SessionDialogs({
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
  sessionsApiPath
} = {}) {
  const abandonDialogOpen = ref(false);
  const abandonDialogSessionId = ref("");
  const abandonDialogSessionTitle = ref("");
  const inputDialogAction = ref(null);
  const inputDialogError = ref("");
  const inputDialogOpen = ref(false);
  const inputDialogSubmitting = ref(false);
  const inputDialogValues = ref({});

  const {
    clearDiffDialog,
    closeDiffDialog,
    diffDialogOpen,
    diffError,
    diffLoading,
    diffPayload,
    loadDiff,
    openDiffDialog
  } = useVibe64DiffDialog({
    canOpen: canOpenDiff,
    selectedSessionId
  });

  const abandonCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_SESSIONS_API_SUFFIX,
    buildCommandOptions: (_payload, { context }) => ({
      method: "POST",
      options: LOCAL_STUDIO_COMMAND_OPTIONS,
      path: vibe64SessionPath(sessionsApiPath.value, context?.sessionId, "/abandon")
    }),
    fallbackRunError: "Vibe64 session could not be abandoned.",
    messages: {
      error: "Vibe64 session could not be abandoned.",
      success: "Vibe64 session abandoned."
    },
    onRunSuccess: async (_response, { context } = {}) => {
      onAbandoned();
      await refreshSessionData();
      if (!context?.sessionId || context.sessionId === unref(selectedSessionId)) {
        clearSelectedSession();
      }
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.sessions.abandon",
    surfaceId: VIBE64_SURFACE_ID,
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
      load: loadDiff,
      loading: diffLoading,
      open: diffDialogOpen,
      openDialog: openDiffDialog,
      payload: diffPayload
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
  useVibe64SessionDialogs
};
