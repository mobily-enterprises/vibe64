import { computed, onBeforeUnmount, ref } from "vue";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { getUsersWebHttpClient } from "@jskit-ai/users-web/client/lib/httpClient";
import {
  VIBE64_COMPOSER_CHANGED_EVENT,
  vibe64ComposerDraftPath
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";
import {
  vibe64SessionDebugError,
  vibe64SessionDebugLog
} from "@/lib/vibe64SessionDebugLog.js";

const LOCAL_TYPING_GRACE_MS = 1200;
const PUBLISH_DEBOUNCE_MS = 180;
const COMPOSER_DRAFT_KIND = Object.freeze({
  DRAFT: "draft",
  SUBMISSION_REJECTED: "submission_rejected",
  SUBMISSION_START: "submission_start"
});

function createComposerOriginId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `composer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function plainObject(value = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizedDraftFields(fields = {}) {
  return Object.fromEntries(
    Object.entries(plainObject(fields))
      .map(([key, value]) => [String(key || "").trim(), String(value ?? "")])
      .filter(([key]) => Boolean(key))
  );
}

function normalizedDraftKind(value = "") {
  const kind = String(value || "").trim();
  return Object.values(COMPOSER_DRAFT_KIND).includes(kind) ? kind : COMPOSER_DRAFT_KIND.DRAFT;
}

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
  const originId = createComposerOriginId();
  const lastLocalEditAt = ref(0);
  let publishTimer = null;

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
        String(payload.originId || "") !== originId;
    },
    onEvent: ({ payload = {} } = {}) => {
      const fields = normalizedDraftFields(payload.fields);
      const kind = normalizedDraftKind(payload.kind);
      if (kind === COMPOSER_DRAFT_KIND.SUBMISSION_START) {
        applySubmissionStart(fields, payload);
        return;
      }
      if (kind === COMPOSER_DRAFT_KIND.SUBMISSION_REJECTED) {
        applySubmissionRejected(fields, payload);
        return;
      }
      if (Date.now() - lastLocalEditAt.value < LOCAL_TYPING_GRACE_MS) {
        return;
      }
      applyDraft(fields, payload);
    }
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
    if (publishTimer) {
      clearTimeout(publishTimer);
    }
    publishTimer = setTimeout(() => {
      publishTimer = null;
      void sendDraft(normalizedFieldName, normalizedDraftFields(fields)).catch((error) => {
        vibe64SessionDebugLog("client.composerDraft.publish.error", {
          error: vibe64SessionDebugError(error),
          sessionId: activeSessionId.value
        });
      });
    }, PUBLISH_DEBOUNCE_MS);
  }

  function clearPendingDraftPublish() {
    if (!publishTimer) {
      return;
    }
    clearTimeout(publishTimer);
    publishTimer = null;
  }

  function publishSubmissionStart(fieldName = "", fields = {}, {
    text = ""
  } = {}) {
    clearPendingDraftPublish();
    if (!active.value) {
      return;
    }
    void sendDraft(fieldName, normalizedDraftFields(fields), {
      kind: COMPOSER_DRAFT_KIND.SUBMISSION_START,
      text
    }).catch((error) => {
      vibe64SessionDebugLog("client.composerDraft.submissionStart.error", {
        error: vibe64SessionDebugError(error),
        sessionId: activeSessionId.value
      });
    });
  }

  function publishSubmissionRejected(fieldName = "", fields = {}, {
    text = ""
  } = {}) {
    clearPendingDraftPublish();
    if (!active.value) {
      return;
    }
    void sendDraft(fieldName, normalizedDraftFields(fields), {
      kind: COMPOSER_DRAFT_KIND.SUBMISSION_REJECTED,
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
    await getUsersWebHttpClient().request(vibe64ComposerDraftPath(activeSessionsApiPath.value, activeSessionId.value), {
      body: {
        controlId: activeControlId.value,
        fieldName,
        fields,
        kind: normalizedDraftKind(options?.kind),
        originId,
        projectSlug: activeProjectSlug.value,
        text: String(options?.text || "").trim()
      },
      method: "POST"
    });
  }

  return {
    originId,
    publishDraftChange,
    publishSubmissionRejected,
    publishSubmissionStart
  };
}

export {
  COMPOSER_DRAFT_KIND,
  LOCAL_TYPING_GRACE_MS,
  PUBLISH_DEBOUNCE_MS,
  normalizedDraftKind,
  normalizedDraftFields,
  useVibe64ComposerDraftSync
};
