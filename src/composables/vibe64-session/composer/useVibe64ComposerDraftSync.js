import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { getUsersWebHttpClient } from "@jskit-ai/users-web/client/lib/httpClient";
import {
  VIBE64_COMPOSER_CHANGED_EVENT,
  vibe64ComposerDraftPath
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  vibe64BrowserTabOriginId,
  vibe64RealtimePayloadFromCurrentTab
} from "@/lib/vibe64BrowserTabOrigin.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";
import {
  vibe64SessionDebugError,
  vibe64SessionDebugLog
} from "@/lib/vibe64SessionDebugLog.js";
import {
  draftFieldsEqual,
  emptyDraftFields,
  normalizedDraftFields
} from "@/composables/vibe64-session/composer/composerDraftFields.js";
import {
  mergeDraftFields
} from "@/composables/vibe64-session/composer/composerDraftMerge.js";
import {
  COMPOSER_DRAFT_KIND,
  draftUpdatedAtMs,
  normalizedDraftKind,
  normalizedDraftRevision
} from "@/composables/vibe64-session/composer/composerDraftProtocol.js";

const LOCAL_TYPING_GRACE_MS = 1200;
const PUBLISH_DEBOUNCE_MS = 180;

function useVibe64ComposerDraftSync({
  applyDraft = () => null,
  applySubmissionRejected = () => null,
  applySubmissionStart = () => null,
  enabled = true,
  projectSlug,
  selectedControl,
  selectedControlValues,
  sessionId,
  sessionsApiPath
} = {}) {
  const originId = vibe64BrowserTabOriginId();
  const baseFields = ref({});
  const baseRevision = ref(0);
  const baseUpdatedAtMs = ref(0);
  const lastLocalEditAt = ref(0);
  const remoteDraftReadPending = ref(false);
  let pendingDraftPublish = null;
  let publishTimer = null;
  let remoteDraftReadId = 0;

  const activeSessionId = computed(() => String(readRefOrGetterValue(sessionId) || "").trim());
  const activeSessionsApiPath = computed(() => String(readRefOrGetterValue(sessionsApiPath) || "").trim());
  const activeControlId = computed(() => String(readRefOrGetterValue(selectedControl)?.id || "").trim());
  const activeProjectSlug = computed(() => String(readRefOrGetterValue(projectSlug) || "").trim());
  const active = computed(() => Boolean(
    readRefOrGetterValue(enabled) &&
    activeSessionId.value &&
    activeSessionsApiPath.value &&
    activeControlId.value
  ));

  useRealtimeEvent({
    enabled: active,
    event: VIBE64_COMPOSER_CHANGED_EVENT,
    matches: ({ payload = {} } = {}) => {
      const payloadProjectSlug = String(payload.projectSlug || "").trim();
      return String(payload.sessionId || "") === activeSessionId.value &&
        String(payload.controlId || "") === activeControlId.value &&
        (!payloadProjectSlug || !activeProjectSlug.value || payloadProjectSlug === activeProjectSlug.value) &&
        !vibe64RealtimePayloadFromCurrentTab(payload, {
          originId
        });
    },
    onEvent: ({ payload = {} } = {}) => {
      const fields = normalizedDraftFields(payload.fields);
      applyIncomingDraft(fields, payload);
    }
  });

  watch(() => [
    active.value ? "active" : "inactive",
    activeSessionsApiPath.value,
    activeSessionId.value,
    activeControlId.value,
    activeProjectSlug.value
  ].join("|"), () => {
    baseFields.value = {};
    baseRevision.value = 0;
    baseUpdatedAtMs.value = 0;
    remoteDraftReadId += 1;
    remoteDraftReadPending.value = active.value;
    if (active.value) {
      const readId = remoteDraftReadId;
      void loadRemoteDraft(readId).catch((error) => {
        vibe64SessionDebugLog("client.composerDraft.read.error", {
          error: vibe64SessionDebugError(error),
          sessionId: activeSessionId.value
        });
      }).finally(() => {
        finishRemoteDraftRead(readId);
      });
    }
  }, {
    immediate: true
  });

  onBeforeUnmount(() => {
    if (publishTimer) {
      clearTimeout(publishTimer);
    }
  });

  function publishDraftChange(fieldName = "", fields = readRefOrGetterValue(selectedControlValues) || {}) {
    if (!active.value) {
      return;
    }
    const normalizedFieldName = String(fieldName || "").trim();
    if (!normalizedFieldName) {
      return;
    }
    lastLocalEditAt.value = Date.now();
    queueDraftPublish(normalizedFieldName, normalizedDraftFields(fields));
  }

  function queueDraftPublish(fieldName = "", fields = {}) {
    if (publishTimer) {
      clearTimeout(publishTimer);
      publishTimer = null;
    }
    pendingDraftPublish = {
      fieldName,
      fields: normalizedDraftFields(fields)
    };
    if (remoteDraftReadPending.value) {
      return;
    }
    startDraftPublishTimer();
  }

  function startDraftPublishTimer() {
    publishTimer = setTimeout(() => {
      const draft = pendingDraftPublish;
      pendingDraftPublish = null;
      publishTimer = null;
      if (!draft) {
        return;
      }
      void sendDraft(draft.fieldName, draft.fields).catch((error) => {
        vibe64SessionDebugLog("client.composerDraft.publish.error", {
          error: vibe64SessionDebugError(error),
          sessionId: activeSessionId.value
        });
      });
    }, PUBLISH_DEBOUNCE_MS);
  }

  function finishRemoteDraftRead(readId = remoteDraftReadId) {
    if (readId !== remoteDraftReadId) {
      return;
    }
    remoteDraftReadPending.value = false;
    if (pendingDraftPublish && !publishTimer) {
      startDraftPublishTimer();
    }
  }

  function clearPendingDraftPublish() {
    if (!publishTimer) {
      return;
    }
    clearTimeout(publishTimer);
    publishTimer = null;
    pendingDraftPublish = null;
  }

  function publishSubmissionStart(fieldName = "", fields = {}, {
    submissionId = "",
    text = ""
  } = {}) {
    clearPendingDraftPublish();
    if (!active.value) {
      return;
    }
    void sendDraft(fieldName, normalizedDraftFields(fields), {
      kind: COMPOSER_DRAFT_KIND.SUBMISSION_START,
      submissionId,
      text
    }).catch((error) => {
      vibe64SessionDebugLog("client.composerDraft.submissionStart.error", {
        error: vibe64SessionDebugError(error),
        sessionId: activeSessionId.value
      });
    });
  }

  function publishSubmissionRejected(fieldName = "", fields = {}, {
    submissionId = "",
    text = ""
  } = {}) {
    clearPendingDraftPublish();
    if (!active.value) {
      return;
    }
    void sendDraft(fieldName, normalizedDraftFields(fields), {
      kind: COMPOSER_DRAFT_KIND.SUBMISSION_REJECTED,
      submissionId,
      text
    }).catch((error) => {
      vibe64SessionDebugLog("client.composerDraft.submissionRejected.error", {
        error: vibe64SessionDebugError(error),
        sessionId: activeSessionId.value
      });
    });
  }

  async function sendDraft(fieldName = "", fields = {}, options = {}) {
    if (!active.value) {
      return;
    }
    const result = await getUsersWebHttpClient().request(vibe64ComposerDraftPath(activeSessionsApiPath.value, activeSessionId.value), {
      body: {
        baseRevision: baseRevision.value,
        controlId: activeControlId.value,
        fieldName,
        fields,
        kind: normalizedDraftKind(options?.kind),
        originId,
        projectSlug: activeProjectSlug.value,
        ...(String(options?.submissionId || "").trim()
          ? { submissionId: String(options.submissionId).trim() }
          : {}),
        text: String(options?.text || "").trim()
      },
      method: "POST"
    });
    const staleDraft = result?.currentDraft &&
      typeof result.currentDraft === "object" &&
      !Array.isArray(result.currentDraft)
      ? result.currentDraft
      : null;
    if (result?.stale === true && staleDraft) {
      applyIncomingDraft(normalizedDraftFields(staleDraft.fields), staleDraft);
      return;
    }
    rememberServerDraft(result?.draft || {
      fieldName,
      fields,
      kind: options?.kind
    });
  }

  async function loadRemoteDraft(readId = remoteDraftReadId) {
    if (!active.value) {
      return;
    }
    const result = await getUsersWebHttpClient().request(
      vibe64ComposerDraftPath(activeSessionsApiPath.value, activeSessionId.value),
      {
        method: "GET",
        query: {
          controlId: activeControlId.value,
          projectSlug: activeProjectSlug.value
        }
      }
    );
    if (readId !== remoteDraftReadId || !active.value) {
      return;
    }
    const draft = result?.draft && typeof result.draft === "object" && !Array.isArray(result.draft)
      ? result.draft
      : null;
    if (draft) {
      applyIncomingDraft(normalizedDraftFields(draft.fields), draft);
    }
  }

  function currentDraftFields() {
    return normalizedDraftFields(readRefOrGetterValue(selectedControlValues) || {});
  }

  function draftFieldNameForPayload(payload = {}, fields = {}) {
    return String(payload?.fieldName || "").trim() || Object.keys(normalizedDraftFields(fields))[0] || "";
  }

  function rememberServerDraft(payload = {}) {
    const kind = normalizedDraftKind(payload?.kind);
    const revision = normalizedDraftRevision(payload?.revision);
    const updatedAtMs = draftUpdatedAtMs(payload?.updatedAt);
    if (revision) {
      baseRevision.value = revision;
    }
    if (updatedAtMs) {
      baseUpdatedAtMs.value = updatedAtMs;
    }
    if (kind === COMPOSER_DRAFT_KIND.SUBMISSION_START) {
      baseFields.value = emptyDraftFields(payload?.fields, payload?.fieldName);
      return;
    }
    baseFields.value = normalizedDraftFields(payload?.fields);
  }

  function applyIncomingDraft(fields = {}, payload = {}) {
    const kind = normalizedDraftKind(payload.kind);
    const revision = normalizedDraftRevision(payload.revision);
    if (revision && revision < baseRevision.value) {
      return;
    }
    const updatedAtMs = draftUpdatedAtMs(payload.updatedAt);
    if (
      !revision &&
      baseRevision.value > 0 &&
      (!updatedAtMs || (baseUpdatedAtMs.value && updatedAtMs < baseUpdatedAtMs.value))
    ) {
      return;
    }
    if (kind === COMPOSER_DRAFT_KIND.SUBMISSION_START) {
      rememberServerDraft({
        ...payload,
        fields
      });
      applySubmissionStart(fields, payload);
      return;
    }
    if (kind === COMPOSER_DRAFT_KIND.SUBMISSION_REJECTED) {
      rememberServerDraft({
        ...payload,
        fields
      });
      applySubmissionRejected(fields, payload);
      return;
    }
    const remoteFields = normalizedDraftFields(fields);
    const merged = mergeDraftFields({
      appendLocalOnEmptyBaseConflict: baseRevision.value === 0 && revision > 0 && lastLocalEditAt.value > 0,
      baseFields: baseFields.value,
      localEditedAt: lastLocalEditAt.value,
      localFields: currentDraftFields(),
      remoteFields,
      remoteUpdatedAt: payload.updatedAt
    });
    baseFields.value = remoteFields;
    if (revision) {
      baseRevision.value = revision;
    }
    if (updatedAtMs) {
      baseUpdatedAtMs.value = updatedAtMs;
    }
    if (!draftFieldsEqual(merged.fields, currentDraftFields())) {
      applyDraft(merged.fields, payload);
    }
    if (merged.shouldPublish) {
      lastLocalEditAt.value = Date.now();
      queueDraftPublish(draftFieldNameForPayload(payload, merged.fields), merged.fields);
    }
  }

  return {
    originId,
    publishDraftChange,
    publishSubmissionRejected,
    publishSubmissionStart
  };
}

export {
  LOCAL_TYPING_GRACE_MS,
  PUBLISH_DEBOUNCE_MS,
  useVibe64ComposerDraftSync
};
