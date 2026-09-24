import { assistantRoutingFromMetadata } from "@local/vibe64-runtime/shared/assistantRouting";
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
import { vibe64RealtimeOriginPayload } from "@/lib/vibe64BrowserTabOrigin.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";
import {
  SESSION_RENEWAL_MAX_HANDOVER_CHARACTERS,
  sessionRenewalAdvisoryPresentation,
  sessionRenewalDraftCharacterCount,
  sessionRenewalOperationKey,
  sessionRenewalPhase,
  sessionRenewalStageLabel,
  sessionRenewalStageProgress,
  sessionRenewalText
} from "@/lib/vibe64SessionRenewalViewModel.js";

const SESSION_RENEWAL_POLL_INTERVAL_MS = 1_200;
const SESSION_RENEWAL_BACKGROUND_POLL_INTERVAL_MS = 5_000;
const SESSION_RENEWAL_RETRY_POLL_INTERVAL_MS = 60_000;
const SESSION_RENEWAL_DRAFT_STORAGE_PREFIX = "vibe64:session-renewal-draft";

function renewalRevision(value = null) {
  const revision = Number(value?.revision);
  return Number.isSafeInteger(revision) && revision >= 1 ? revision : null;
}

function browserSessionStorage(root = globalThis) {
  try {
    return root?.sessionStorage || root?.window?.sessionStorage || null;
  } catch {
    return null;
  }
}

function renewalDraftStorageKey(
  projectSlug = "",
  sessionId = "",
  viewerScope = "",
  renewalId = ""
) {
  const project = String(projectSlug || "").trim();
  const session = String(sessionId || "").trim();
  const viewer = String(viewerScope || "").trim();
  const renewal = String(renewalId || "").trim();
  return project && session && viewer && renewal
    ? `${SESSION_RENEWAL_DRAFT_STORAGE_PREFIX}:${encodeURIComponent(viewer)}:${encodeURIComponent(project)}:${encodeURIComponent(session)}:${encodeURIComponent(renewal)}`
    : "";
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

function useVibe64SessionRenewal({
  active = true,
  draftStorage = browserSessionStorage(),
  focusSession = async () => null,
  refreshSessionData = async () => null,
  selectSession = () => null,
  selectedSession,
  selectedSessionId,
  sessionsApiPath
} = {}) {
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
  const triggerFocusTarget = shallowRef(null);
  const pendingActionState = ref(null);
  const draftText = ref("");
  const hydratedDraftIdentity = ref("");
  const hydratedDraftText = ref("");
  const hydratedDraftGuard = ref(null);
  const draftConflictState = ref(null);
  const draftStorageIdentity = ref("");
  const draftStorageHydrated = ref(false);
  const draftValidationError = ref("");
  const localOperationKey = ref("");
  const snapshot = ref(null);
  const viewerScope = ref("");
  const handledSuccessorId = ref("");
  const successorSelectionPendingId = ref("");
  const successorSelectionError = ref("");
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
  const steps = computed(() => sessionRenewalStageProgress(renewal.value?.stage));
  const draftCharacterCount = computed(() => sessionRenewalDraftCharacterCount(draftText.value));
  const draftTooLong = computed(() => (
    draftCharacterCount.value > SESSION_RENEWAL_MAX_HANDOVER_CHARACTERS
  ));
  const draftDirty = computed(() => Boolean(
    hydratedDraftIdentity.value &&
    sessionRenewalText(draftText.value) !== sessionRenewalText(hydratedDraftText.value)
  ));
  const manualDraftIncomplete = computed(() => Boolean(
    renewal.value?.manualRequired === true &&
    String(renewal.value?.draft?.hash || "").trim() &&
    String(renewal.value?.draft?.hash || "").trim() ===
      String(renewal.value?.manualTemplateHash || "").trim() &&
    !draftDirty.value
  ));
  const draftError = computed(() => {
    if (draftTooLong.value) {
      return `Handover must be ${SESSION_RENEWAL_MAX_HANDOVER_CHARACTERS.toLocaleString()} characters or fewer.`;
    }
    if (draftValidationError.value) {
      return draftValidationError.value;
    }
    return manualDraftIncomplete.value
      ? "Complete every handover section before creating the fresh session."
      : "";
  });
  const draftConflict = computed(() => draftConflictState.value);
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

  function renewalDraftState(candidate = null) {
    const draft = candidate?.draft;
    const identity = draft ? `${Number(draft.revision || 0)}:${String(draft.hash || "")}` : "";
    return {
      guard: {
        expectedHash: String(draft?.hash || ""),
        expectedRevision: Number(draft?.revision || 0),
        operationKey: String(candidate?.operationKey || currentOperationKey())
      },
      identity,
      text: identity ? sessionRenewalText(draft?.text) : ""
    };
  }

  function activeDraftStorageKey() {
    return draftStorageIdentity.value;
  }

  function removeStoredDraft() {
    const key = activeDraftStorageKey();
    if (!key || !draftStorage) {
      return;
    }
    try {
      draftStorage.removeItem(key);
    } catch {
      // Per-tab preservation is a convenience; blocked storage must not break renewal.
    }
  }

  function persistStoredDraft() {
    const key = activeDraftStorageKey();
    if (!key || !draftStorage || !draftStorageHydrated.value) {
      return;
    }
    if (
      phase.value !== "review" ||
      !draftDirty.value ||
      !hydratedDraftIdentity.value ||
      !renewal.value?.renewalId
    ) {
      removeStoredDraft();
      return;
    }
    try {
      draftStorage.setItem(key, JSON.stringify({
        baseGuard: hydratedDraftGuard.value,
        baseIdentity: hydratedDraftIdentity.value,
        baseText: hydratedDraftText.value,
        renewalId: String(renewal.value.renewalId),
        text: sessionRenewalText(draftText.value)
      }));
    } catch {
      // The durable server draft still exists when per-tab storage is unavailable or full.
    }
  }

  function restoreStoredDraft(candidate = null) {
    if (draftStorageHydrated.value) {
      return;
    }
    draftStorageHydrated.value = true;
    const key = activeDraftStorageKey();
    if (!key || !draftStorage || String(candidate?.status || "") !== "review") {
      return;
    }
    try {
      const stored = JSON.parse(String(draftStorage.getItem(key) || "null"));
      if (
        !stored ||
        typeof stored !== "object" ||
        Array.isArray(stored) ||
        String(stored.renewalId || "") !== String(candidate?.renewalId || "") ||
        !String(stored.baseIdentity || "") ||
        typeof stored.baseText !== "string" ||
        typeof stored.text !== "string" ||
        !stored.baseGuard ||
        typeof stored.baseGuard !== "object" ||
        Array.isArray(stored.baseGuard)
      ) {
        removeStoredDraft();
        return;
      }
      hydratedDraftIdentity.value = String(stored.baseIdentity);
      hydratedDraftText.value = sessionRenewalText(stored.baseText);
      hydratedDraftGuard.value = {
        expectedHash: String(stored.baseGuard.expectedHash || ""),
        expectedRevision: Number(stored.baseGuard.expectedRevision || 0),
        operationKey: String(stored.baseGuard.operationKey || "")
      };
      draftText.value = sessionRenewalText(stored.text);
    } catch {
      removeStoredDraft();
    }
  }

  function resetDraftHydration() {
    hydratedDraftIdentity.value = "";
    hydratedDraftText.value = "";
    hydratedDraftGuard.value = null;
    draftConflictState.value = null;
    draftStorageHydrated.value = false;
    draftValidationError.value = "";
    draftText.value = "";
  }

  function prepareDraftContext(candidate = null, nextViewerScope = "") {
    const normalizedViewerScope = String(nextViewerScope || "").trim();
    if (!normalizedViewerScope) {
      return false;
    }
    const nextStorageIdentity = candidate
      ? renewalDraftStorageKey(
        projectSlug.value,
        sessionId.value,
        normalizedViewerScope,
        candidate.renewalId
      )
      : "";
    if (
      viewerScope.value === normalizedViewerScope &&
      draftStorageIdentity.value === nextStorageIdentity
    ) {
      return true;
    }
    persistStoredDraft();
    viewerScope.value = normalizedViewerScope;
    draftStorageIdentity.value = nextStorageIdentity;
    resetDraftHydration();
    snapshot.value = null;
    localOperationKey.value = "";
    return true;
  }

  function hydrateDraft(candidate = null, { preserveLocal = false } = {}) {
    const next = renewalDraftState(candidate);
    hydratedDraftIdentity.value = next.identity;
    hydratedDraftText.value = next.text;
    hydratedDraftGuard.value = next.guard;
    if (!preserveLocal) {
      draftText.value = next.text;
    }
    draftConflictState.value = null;
    draftValidationError.value = "";
  }

  function reconcileDraft(candidate = null) {
    const next = renewalDraftState(candidate);
    if (next.identity === hydratedDraftIdentity.value) {
      return;
    }
    const reviewStillEditable = String(candidate?.status || "") === "review";
    if (
      !reviewStillEditable ||
      !hydratedDraftIdentity.value ||
      !draftDirty.value ||
      next.text === sessionRenewalText(draftText.value)
    ) {
      hydrateDraft(candidate);
      return;
    }
    draftConflictState.value = next;
  }

  function acceptRenewal(candidate = null, { responseViewerScope = "" } = {}) {
    if (candidate === null || candidate === undefined) {
      if (!prepareDraftContext(null, responseViewerScope)) {
        return false;
      }
      if (!snapshot.value) {
        snapshot.value = null;
      }
      return true;
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
    const randomId = globalThis.crypto?.randomUUID?.() || "";
    localOperationKey.value = sessionRenewalOperationKey(sessionId.value, { randomId });
    return localOperationKey.value;
  }

  function draftGuard() {
    const guard = hydratedDraftGuard.value || renewalDraftState(renewal.value).guard;
    return {
      expectedHash: String(guard?.expectedHash || ""),
      expectedRevision: Number(guard?.expectedRevision || 0),
      operationKey: String(guard?.operationKey || currentOperationKey())
    };
  }

  async function reload() {
    if (manualReloading.value) {
      return renewal.value;
    }
    manualReloading.value = true;
    try {
      await resource.reload?.();
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

  async function confirm(workflowEngineId = "") {
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
          ...(workflowEngineId
            ? { workflowEngineId }
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

  async function cancel() {
    if (phase.value !== "review" || draftConflict.value || busy.value) {
      return null;
    }
    const result = await runAction("cancel", "Cancelling…", () => postCommand.run({
      body: draftGuard(),
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

  function request({ returnFocusTarget = null } = {}) {
    if (!visible.value || !hostActive.value) {
      return;
    }
    const target = returnFocusTarget?.$el || returnFocusTarget;
    triggerFocusTarget.value = typeof target?.focus === "function" ? target : null;
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
    if (target?.isConnected !== true || typeof target.focus !== "function") {
      return false;
    }
    target.focus({ preventScroll: true });
    return true;
  }

  function setDraftText(value = "") {
    draftText.value = sessionRenewalText(value);
    draftValidationError.value = "";
    persistStoredDraft();
  }

  function acceptLatestDraft() {
    const conflict = draftConflictState.value;
    if (!conflict) {
      return;
    }
    hydratedDraftIdentity.value = conflict.identity;
    hydratedDraftText.value = conflict.text;
    hydratedDraftGuard.value = conflict.guard;
    draftText.value = conflict.text;
    draftConflictState.value = null;
    draftValidationError.value = "";
    persistStoredDraft();
  }

  function keepLocalDraft() {
    const conflict = draftConflictState.value;
    if (!conflict) {
      return;
    }
    hydratedDraftIdentity.value = conflict.identity;
    hydratedDraftText.value = conflict.text;
    hydratedDraftGuard.value = conflict.guard;
    draftConflictState.value = null;
    persistStoredDraft();
  }

  function availableSuccessorId() {
    return renewal.value?.status === "completed"
      ? String(renewal.value?.successor?.sessionId || "").trim()
      : "";
  }

  function refreshResultError(result = null) {
    if (Array.isArray(result)) {
      for (const entry of result) {
        if (entry?.status === "rejected") {
          return entry.reason instanceof Error
            ? entry.reason
            : new Error(String(entry?.reason || "Session list could not be refreshed."));
        }
        if (entry?.status === "fulfilled") {
          const nestedError = refreshResultError(entry.value);
          if (nestedError) {
            return nestedError;
          }
        }
      }
      return null;
    }
    if (
      result &&
      typeof result === "object" &&
      !Array.isArray(result) &&
      (result.isError === true || result.status === "error")
    ) {
      return result.error instanceof Error
        ? result.error
        : new Error(String(result.error || "Session list could not be refreshed."));
    }
    return null;
  }

  async function openSuccessor() {
    const successorId = availableSuccessorId();
    if (
      !successorId ||
      !hostActive.value ||
      handledSuccessorId.value === successorId ||
      successorSelectionPendingId.value
    ) {
      return false;
    }
    const predecessorSessionId = sessionId.value;
    successorSelectionPendingId.value = successorId;
    successorSelectionError.value = "";
    try {
      const refreshResult = await refreshSessionData({
        includeList: true,
        reason: "session-renewal-successor-available"
      });
      const refreshFailure = refreshResultError(refreshResult);
      if (refreshFailure) {
        throw refreshFailure;
      }
      if (
        !hostActive.value ||
        sessionId.value !== predecessorSessionId ||
        availableSuccessorId() !== successorId
      ) {
        return false;
      }
      await Promise.resolve(selectSession(successorId));
      handledSuccessorId.value = successorId;
      triggerFocusTarget.value = null;
      open.value = false;
      await Promise.resolve(focusSession(successorId)).catch(() => null);
      return true;
    } catch (error) {
      if (hostActive.value && sessionId.value === predecessorSessionId) {
        successorSelectionError.value = error instanceof Error
          ? error.message
          : String(error || "The fresh session could not be opened.");
        open.value = true;
      }
      return false;
    } finally {
      if (successorSelectionPendingId.value === successorId) {
        successorSelectionPendingId.value = "";
      }
    }
  }

  let pollTimer = null;
  function clearPoll() {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }
  function schedulePoll() {
    clearPoll();
    if (
      !hostActive.value ||
      (
        renewal.value?.status !== "running" &&
        !maintenanceInProgress.value &&
        !maintenanceNeedsRetry.value
      )
    ) {
      return;
    }
    const pollIntervalMs = maintenanceNeedsRetry.value
      ? SESSION_RENEWAL_RETRY_POLL_INTERVAL_MS
      : open.value
        ? SESSION_RENEWAL_POLL_INTERVAL_MS
        : SESSION_RENEWAL_BACKGROUND_POLL_INTERVAL_MS;
    pollTimer = setTimeout(async () => {
      pollTimer = null;
      await reload().catch(() => null);
      schedulePoll();
    }, pollIntervalMs);
  }

  watch([projectSlug, sessionId], () => {
    persistStoredDraft();
    snapshot.value = null;
    localOperationKey.value = "";
    viewerScope.value = "";
    draftStorageIdentity.value = "";
    resetDraftHydration();
    handledSuccessorId.value = "";
    successorSelectionPendingId.value = "";
    successorSelectionError.value = "";
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
      clearPoll();
    }
  }, { immediate: true });
  watch([
    hostActive,
    open,
    projectSlug,
    sessionId,
    () => renewal.value?.status,
    () => renewal.value?.maintenance?.status
  ], schedulePoll, { immediate: true });
  watch([hostActive, () => availableSuccessorId()], ([activeNow, successorId]) => {
    if (activeNow && successorId && handledSuccessorId.value !== successorId) {
      void openSuccessor();
    }
  }, { immediate: true });

  onScopeDispose(() => {
    persistStoredDraft();
    triggerFocusTarget.value = null;
    clearPoll();
  });

  return {
    actionPresentation,
    actionLabel,
    workflowEngineId: computed(() => assistantRoutingFromMetadata(session.value?.metadata || {})?.workflowEngineId || session.value?.assistantSelection?.engineId || ""),
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
    setDraftText,
    saveDraft,
    sourceOperationsSuspended,
    stageLabel,
    steps,
    successorSelectionError,
    successorSelectionPending: computed(() => Boolean(successorSelectionPendingId.value)),
    visible
  };
}

export {
  SESSION_RENEWAL_BACKGROUND_POLL_INTERVAL_MS,
  SESSION_RENEWAL_DRAFT_STORAGE_PREFIX,
  SESSION_RENEWAL_POLL_INTERVAL_MS,
  SESSION_RENEWAL_RETRY_POLL_INTERVAL_MS,
  renewalDraftStorageKey,
  renewalHandoverValidationMessage,
  renewalRevision,
  useVibe64SessionRenewal
};
