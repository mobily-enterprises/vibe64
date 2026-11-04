import { computed, onScopeDispose, ref, shallowRef, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { useVibe64ProjectSlug } from "@/composables/useVibe64ProjectScope.js";
import { mountedSessionRealtimeShouldRefresh } from "@/lib/vibe64MountedSessionState.js";
import {
  VIBE64_SESSION_CHANGED_EVENT,
  VIBE64_SESSIONS_API_SUFFIX,
  VIBE64_SURFACE_ID,
  vibe64SessionPath,
  vibe64SessionQueryKey
} from "@/lib/vibe64SessionRequestConfig.js";
import { vibe64ApiError } from "@/lib/vibe64ApiResponses.js";
import { browserTabSessionStorage, vibe64RealtimeOriginPayload } from "@/lib/vibe64BrowserTabOrigin.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";
import { pageRandomUUID } from "@/lib/browser.js";
import {
  SESSION_RENEWAL_MAX_HANDOVER_CHARACTERS,
  sessionRenewalAdvisoryPresentation,
  sessionRenewalOperationKey,
  sessionRenewalPhase,
  sessionRenewalStageLabel,
  sessionRenewalStageProgress,
  sessionRenewalText
} from "@/lib/vibe64SessionRenewalViewModel.js";
import { useVibe64SessionRenewalDraft } from "@/composables/useVibe64SessionRenewalDraft.js";
import { useVibe64SessionRenewalPolling } from "@/composables/useVibe64SessionRenewalPolling.js";
import { useVibe64SessionRenewalSuccessor } from "@/composables/useVibe64SessionRenewalSuccessor.js";

function renewalRevision(value = null) {
  const revision = Number(value?.revision);
  return Number.isSafeInteger(revision) && revision >= 1 ? revision : null;
}

function renewalHandoverValidationMessage(error = null) {
  const response = error?.response;
  const code = String(
    error?.code || response?.code || response?.errors?.[0]?.code || ""
  ).trim();
  if (!code.startsWith("vibe64_session_renewal_handover_")) {
    return "";
  }
  return String(
    error?.message || response?.errors?.[0]?.message || response?.error ||
      "Review the handover and correct the highlighted problem."
  ).trim();
}

function keepRenewalHandoverValidationInContext(error = null) {
  if (renewalHandoverValidationMessage(error)) {
    // useCommand reports failures after onRunError returns. Rethrowing here
    // keeps field-owned validation beside the handover without duplicating it
    // in the shared action-feedback surface.
    throw error;
  }
}

/**
 * The selected session's renewal: its dialog, handover draft, progress and the fresh session it opens.
 * @param {object} options
 * @param {import("vue").MaybeRefOrGetter<boolean>} [options.active] Whether this session's host is the active one.
 * @param {Storage | null} [options.draftStorage] Where unsent handover drafts survive a reload of this tab.
 * @param {(sessionId: string) => Promise<boolean>} options.focusSession Places focus in the fresh session once it mounts.
 * @param {(options?: Record<string, any>) => Promise<unknown>} options.refreshSessionData Rereads the session list.
 * @param {(sessionId: string) => void} options.selectSession Opens the fresh session.
 * @param {import("vue").MaybeRefOrGetter<Record<string, any> | null>} options.selectedSession
 * @param {import("vue").MaybeRefOrGetter<string>} options.selectedSessionId
 * @param {import("vue").MaybeRefOrGetter<string>} options.sessionsApiPath
 */
function useVibe64SessionRenewal({
  active = true,
  draftStorage = browserTabSessionStorage(),
  focusSession,
  refreshSessionData,
  selectSession,
  selectedSession,
  selectedSessionId,
  sessionsApiPath
}) {
  const projectSlug = useVibe64ProjectSlug();
  const hostActive = computed(() => readRefOrGetterValue(active) !== false);
  const sessionId = computed(() => String(readRefOrGetterValue(selectedSessionId) || "").trim());
  const session = computed(() => readRefOrGetterValue(selectedSession) || null);
  const apiPath = computed(() => String(readRefOrGetterValue(sessionsApiPath) || "").trim());
  const renewalPath = computed(() => (
    sessionId.value && apiPath.value
      ? vibe64SessionPath(apiPath.value, sessionId.value, "/renewal")
      : ""
  ));
  const open = ref(false);
  const triggerFocusTarget = shallowRef(/** @type {HTMLElement | null} */ (null));
  const pendingActionState = ref(null);
  const localOperationKey = ref("");
  const snapshot = ref(null);
  const manualReloading = ref(false);

  const resource = useEndpointResource({
    enabled: computed(() => Boolean(sessionId.value && apiPath.value)),
    fallbackLoadError: "Session renewal could not be loaded.",
    path: renewalPath,
    queryKey: computed(() => [
      ...vibe64SessionQueryKey(
        VIBE64_SURFACE_ID,
        ROUTE_VISIBILITY_PUBLIC,
        projectSlug.value
      ),
      sessionId.value,
      "renewal"
    ]),
    queryOptions: {
      refetchOnMount: "always",
      refetchOnWindowFocus: false
    },
    readMethod: "GET",
    realtime: {
      event: VIBE64_SESSION_CHANGED_EVENT,
      matches: ({ payload = {} } = {}) => mountedSessionRealtimeShouldRefresh(
        { payload },
        sessionId.value
      )
    },
    refreshOnPull: true,
    requestRecoveryLabel: "Session renewal"
  });

  const postCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_SESSIONS_API_SUFFIX,
    buildCommandOptions: (_model, { context }) => ({
      method: "POST",
      path: String(context?.path || "")
    }),
    buildRawPayload: (_model, { context }) => vibe64RealtimeOriginPayload(context?.body || {}),
    fallbackRunError: "Session renewal could not continue.",
    messages: { error: "Session renewal could not continue." },
    onRunError: keepRenewalHandoverValidationInContext,
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.sessions.renewal.post",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });
  const patchCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_SESSIONS_API_SUFFIX,
    buildCommandOptions: (_model, { context }) => ({
      method: "PATCH",
      path: String(context?.path || "")
    }),
    buildRawPayload: (_model, { context }) => vibe64RealtimeOriginPayload(context?.body || {}),
    fallbackRunError: "The handover draft could not be saved.",
    messages: { error: "The handover draft could not be saved." },
    onRunError: keepRenewalHandoverValidationInContext,
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.sessions.renewal.patch",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "PATCH"
  });

  const renewal = computed(() => snapshot.value);
  const advisory = computed(() => session.value?.renewalAdvisory || {});
  const advisoryPresentation = computed(() => sessionRenewalAdvisoryPresentation(advisory.value));
  const loadError = computed(() => String(resource.loadError?.value || ""));
  const refreshError = computed(() => (
    snapshot.value && loadError.value ? loadError.value : ""
  ));
  const refreshing = computed(() => Boolean(
    manualReloading.value || (snapshot.value && resource.isLoading?.value)
  ));
  const initialLoading = computed(() => Boolean(
    !snapshot.value && (resource.isInitialLoading?.value || resource.isLoading?.value)
  ));
  const phase = computed(() => sessionRenewalPhase(renewal.value, {
    initialLoading: initialLoading.value,
    loadError: loadError.value
  }));
  const maintenanceNeedsRetry = computed(() => Boolean(
    renewal.value?.status === "completed" &&
    renewal.value?.maintenance?.status === "failed"
  ));
  const maintenanceInProgress = computed(() => Boolean(
    renewal.value?.status === "completed" &&
    renewal.value?.maintenance?.status === "pending"
  ));
  const maintenanceError = computed(() => String(
    renewal.value?.maintenance?.error?.message ||
    "The fresh session is ready, but Vibe64 could not finish retiring the old session resources."
  ).trim());
  const stageLabel = computed(() => sessionRenewalStageLabel(renewal.value?.stage));
  const steps = computed(() => sessionRenewalStageProgress(renewal.value?.stage));
  const {
    acceptLatestDraft,
    draftCharacterCount,
    draftConflict,
    draftDirty,
    draftError,
    draftGuard,
    draftText,
    draftTooLong,
    draftValidationError,
    enterDraftContext,
    keepLocalDraft,
    leaveDraftContext,
    manualDraftIncomplete,
    persistStoredDraft,
    reconcileDraft,
    restoreStoredDraft,
    updateDraftText
  } = useVibe64SessionRenewalDraft({
    currentOperationKey,
    draftStorage,
    phase,
    projectSlug,
    renewal,
    sessionId
  });
  const pendingAction = computed(() => (
    pendingActionState.value?.sessionId === sessionId.value
      ? String(pendingActionState.value?.name || "")
      : ""
  ));
  const sourceOperationsSuspended = computed(() => Boolean(
    ["draft", "confirm", "retry"].includes(pendingAction.value) ||
    ["running", "completed"].includes(String(renewal.value?.status || "").trim()) ||
    String(renewal.value?.stage || "").trim() === "failure_restoring"
  ));
  const actionLabel = computed(() => (
    pendingAction.value ? String(pendingActionState.value?.label || "") : ""
  ));
  const busy = computed(() => Boolean(pendingAction.value));
  const canConfirm = computed(() => Boolean(
    phase.value === "review" &&
    sessionRenewalText(draftText.value).trim() &&
    !draftTooLong.value &&
    !draftValidationError.value &&
    !manualDraftIncomplete.value &&
    !draftConflict.value &&
    !busy.value
  ));
  const canSaveDraft = computed(() => Boolean(
    phase.value === "review" &&
    draftDirty.value &&
    !draftTooLong.value &&
    !draftValidationError.value &&
    !draftConflict.value &&
    !busy.value
  ));
  const visible = computed(() => {
    const status = String(renewal.value?.status || "").trim();
    const durableRenewalNeedsAccess = ["completed", "failed", "review", "running"].includes(status);
    return Boolean(sessionId.value && (
      durableRenewalNeedsAccess || (
        session.value?.archived !== true && session.value?.status !== "archived"
      )
    ));
  });

  function prepareDraftContext(candidate = null, nextViewerScope = "") {
    const normalizedViewerScope = String(nextViewerScope || "").trim();
    if (!normalizedViewerScope) {
      return false;
    }
    if (enterDraftContext(candidate, normalizedViewerScope)) {
      snapshot.value = null;
      localOperationKey.value = "";
    }
    return true;
  }

  function acceptRenewal(candidate = null, { responseViewerScope = "" } = {}) {
    if (candidate === null || candidate === undefined) {
      return prepareDraftContext(null, responseViewerScope);
    }
    if (
      typeof candidate !== "object" ||
      Array.isArray(candidate) ||
      String(candidate.sessionId || "").trim() !== sessionId.value
    ) {
      return false;
    }
    const candidateRevision = renewalRevision(candidate);
    if (candidateRevision === null) {
      return false;
    }
    if (!prepareDraftContext(candidate, responseViewerScope)) {
      return false;
    }
    const currentRevision = renewalRevision(snapshot.value);
    if (currentRevision !== null && candidateRevision <= currentRevision) {
      return candidateRevision === currentRevision;
    }
    restoreStoredDraft(candidate);
    reconcileDraft(candidate);
    snapshot.value = candidate;
    persistStoredDraft();
    return true;
  }

  function currentOperationKey() {
    return String(renewal.value?.operationKey || localOperationKey.value || "").trim();
  }

  function createOperationKey() {
    const randomId = pageRandomUUID();
    localOperationKey.value = sessionRenewalOperationKey(sessionId.value, { randomId });
    return localOperationKey.value;
  }

  async function reload() {
    if (manualReloading.value) {
      return renewal.value;
    }
    manualReloading.value = true;
    try {
      await resource.reload();
      return renewal.value;
    } finally {
      manualReloading.value = false;
    }
  }

  let nextActionId = 0;
  async function runAction(name, label, operation) {
    const actionSessionId = sessionId.value;
    if (!actionSessionId || busy.value) {
      return null;
    }
    const actionId = ++nextActionId;
    pendingActionState.value = {
      actionId,
      label,
      name,
      sessionId: actionSessionId
    };
    try {
      let response;
      try {
        response = await operation();
      } catch (error) {
        if (sessionId.value !== actionSessionId) {
          return null;
        }
        throw error;
      }
      if (sessionId.value !== actionSessionId) {
        return null;
      }
      if (!response || response.ok === false) {
        throw vibe64ApiError(response, "Session renewal could not continue.");
      }
      if (!acceptRenewal(response.renewal || null, {
        responseViewerScope: response.viewerScope
      })) {
        return null;
      }
      void reload().catch(() => null);
      return response.renewal || null;
    } finally {
      if (pendingActionState.value?.actionId === actionId) {
        pendingActionState.value = null;
      }
    }
  }

  async function requestDraft() {
    if (busy.value) {
      return null;
    }
    const operationKey = createOperationKey();
    return runAction("draft", "Starting…", () => postCommand.run({
      body: { operationKey },
      path: `${renewalPath.value}/draft`
    }));
  }

  async function saveDraft({ pendingActionName = "save" } = {}) {
    if (!canSaveDraft.value) {
      return renewal.value;
    }
    try {
      return await runAction(pendingActionName, "Saving…", () => patchCommand.run({
        body: {
          ...draftGuard(),
          draft: sessionRenewalText(draftText.value)
        },
        path: `${renewalPath.value}/draft`
      }));
    } catch (error) {
      const message = renewalHandoverValidationMessage(error);
      if (!message) {
        throw error;
      }
      draftValidationError.value = message;
      return null;
    }
  }

  // A successor model other than main chat's own makes the fresh chat Custom.
  async function confirm(assistantSelection = null) {
    if (!canConfirm.value) {
      return null;
    }
    if (draftDirty.value) {
      const saved = await saveDraft({ pendingActionName: "confirm" });
      if (!saved) {
        return null;
      }
    }
    try {
      return await runAction("confirm", "Renewing…", () => postCommand.run({
        body: {
          ...draftGuard(),
          ...(assistantSelection
            ? { assistantSelection }
            : {})
        },
        path: `${renewalPath.value}/confirm`
      }));
    } catch (error) {
      const message = renewalHandoverValidationMessage(error);
      if (!message) {
        throw error;
      }
      draftValidationError.value = message;
      return null;
    }
  }

  /** Cancel a handover under review, or a failed renewal: its fresh session is discarded and this one kept. */
  async function cancel() {
    const reviewing = phase.value === "review";
    if ((!reviewing && phase.value !== "failed") || (reviewing && draftConflict.value) || busy.value) {
      return null;
    }
    const result = await runAction("cancel", "Cancelling…", () => postCommand.run({
      body: reviewing ? draftGuard() : { operationKey: currentOperationKey() },
      path: `${renewalPath.value}/cancel`
    }));
    if (result?.status === "cancelled") {
      open.value = false;
    }
    return result;
  }

  async function retry() {
    if ((phase.value !== "failed" && !maintenanceNeedsRetry.value) || busy.value) {
      return null;
    }
    return runAction(
      "retry",
      maintenanceNeedsRetry.value ? "Retrying cleanup…" : "Retrying…",
      () => postCommand.run({
        body: { operationKey: currentOperationKey() },
        path: `${renewalPath.value}/retry`
      })
    );
  }

  /**
   * Opens the dialog; closing it later returns focus to the control that asked for it.
   * @param {{ returnFocusTarget?: HTMLElement | null }} [options]
   */
  function request({ returnFocusTarget = null } = {}) {
    if (!visible.value || !hostActive.value) {
      return;
    }
    triggerFocusTarget.value = returnFocusTarget;
    open.value = true;
    void reload().catch(() => null);
  }

  function close() {
    persistStoredDraft();
    open.value = false;
  }

  function restoreTriggerFocus() {
    if (open.value) {
      return false;
    }
    const target = triggerFocusTarget.value;
    triggerFocusTarget.value = null;
    if (target?.isConnected !== true) {
      return false;
    }
    target.focus({ preventScroll: true });
    return true;
  }

  watch([projectSlug, sessionId], () => {
    leaveDraftContext();
    snapshot.value = null;
    localOperationKey.value = "";
    triggerFocusTarget.value = null;
    open.value = false;
  }, { immediate: true });
  watch(() => resource.data?.value || null, (response) => {
    if (!response || response.ok === false) {
      return;
    }
    acceptRenewal(response.renewal || null, {
      responseViewerScope: response.viewerScope
    });
  }, { immediate: true });
  watch(hostActive, (activeNow) => {
    if (!activeNow) {
      triggerFocusTarget.value = null;
      open.value = false;
    }
  }, { immediate: true });
  useVibe64SessionRenewalPolling({
    hostActive,
    maintenanceInProgress,
    maintenanceNeedsRetry,
    open,
    projectSlug,
    reload,
    renewal,
    sessionId
  });
  const {
    openSuccessor,
    successorSelectionError,
    successorSelectionPending
  } = useVibe64SessionRenewalSuccessor({
    focusSession,
    hostActive,
    open,
    projectSlug,
    refreshSessionData,
    renewal,
    selectSession,
    sessionId,
    triggerFocusTarget
  });
  // The session toolbar's renewal action, which reports whether the fresh session could open.
  const actionPresentation = computed(() => {
    const status = String(renewal.value?.status || "").trim();
    if (status === "review") {
      return {
        attention: true,
        color: "primary",
        label: "Review handover",
        reason: "Review the handover before creating the fresh session."
      };
    }
    if (status === "running") {
      return {
        attention: true,
        color: "primary",
        label: "Renewal in progress",
        reason: stageLabel.value
      };
    }
    if (status === "failed") {
      return {
        attention: true,
        color: "error",
        label: "Renewal needs attention",
        reason: String(
          renewal.value?.error?.message || "Open session renewal to continue safely."
        ).trim()
      };
    }
    if (status === "completed") {
      if (maintenanceNeedsRetry.value) {
        return {
          attention: true,
          color: "warning",
          label: "Cleanup needs retry",
          reason: maintenanceError.value
        };
      }
      return {
        attention: true,
        color: successorSelectionError.value ? "error" : "success",
        label: successorSelectionError.value ? "Open fresh session" : "Opening fresh session",
        reason: successorSelectionError.value || "The fresh session is ready."
      };
    }
    return advisoryPresentation.value;
  });

  onScopeDispose(() => {
    triggerFocusTarget.value = null;
  });

  return {
    actionPresentation,
    actionLabel,
    acceptLatestDraft,
    advisory,
    advisoryPresentation,
    busy,
    canConfirm,
    canSaveDraft,
    cancel,
    close,
    confirm,
    draftCharacterCount,
    draftConflict,
    draftDirty,
    draftError,
    draftText,
    draftTooLong,
    initialLoading,
    keepLocalDraft,
    loadError,
    maintenanceError,
    maintenanceInProgress,
    maintenanceNeedsRetry,
    maxHandoverCharacters: SESSION_RENEWAL_MAX_HANDOVER_CHARACTERS,
    open,
    openSuccessor,
    pendingAction,
    phase,
    refreshError,
    refreshing,
    reload,
    renewal,
    request,
    requestDraft,
    restoreTriggerFocus,
    retry,
    setDraftText: updateDraftText,
    saveDraft,
    sourceOperationsSuspended,
    stageLabel,
    steps,
    successorSelectionError,
    successorSelectionPending,
    visible
  };
}

export {
  renewalHandoverValidationMessage,
  renewalRevision,
  useVibe64SessionRenewal
};
