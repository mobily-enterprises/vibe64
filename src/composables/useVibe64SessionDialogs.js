import { computed, proxyRefs, ref, unref } from "vue";
import {
  useVibe64DiffDialog
} from "@/composables/useVibe64DiffDialog.js";
import {
  emptyActionInputValues,
  normalizeActionInputFields,
  requiredActionInputMissing
} from "@/lib/vibe64ActionInputModel.js";
import {
  LOCAL_STUDIO_COMMAND_OPTIONS,
  vibe64SessionPath
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  readRefOrGetterBoolean
} from "@/lib/vueRefOrGetterValue.js";
import {
  studioHttpClient
} from "@/lib/studioHttp.js";

function useVibe64SessionDialogs({
  activeActionId,
  canOpenDiff = () => false,
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
  const abandonRunning = ref(false);
  const abandonMessage = ref("");
  const abandonMessageType = ref("");
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

  const abandonCommand = proxyRefs({
    isRunning: abandonRunning,
    message: abandonMessage,
    messageType: abandonMessageType,
    run: runAbandonCommand
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

  async function runAbandonCommand({
    sessionId = ""
  } = {}) {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId || abandonRunning.value) {
      return null;
    }
    abandonRunning.value = true;
    abandonMessage.value = "";
    abandonMessageType.value = "";
    try {
      const response = await studioHttpClient.post(
        vibe64SessionPath(sessionsApiPath.value, normalizedSessionId, "/abandon"),
        {},
        LOCAL_STUDIO_COMMAND_OPTIONS
      );
      abandonMessage.value = "Vibe64 session abandoned.";
      abandonMessageType.value = "success";
      clearAbandonDialog();
      onAbandoned();
      await refreshSessionData();
      return response;
    } catch (error) {
      abandonMessage.value = String(error?.message || error || "Vibe64 session could not be abandoned.");
      abandonMessageType.value = "error";
      throw error;
    } finally {
      abandonRunning.value = false;
    }
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
