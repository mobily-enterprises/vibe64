import { computed, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { useList } from "@jskit-ai/users-web/client/composables/useList";
import { usePaths } from "@jskit-ai/users-web/client/composables/usePaths";
import { useStoredSelection } from "@/composables/useStoredSelection.js";
import {
  AI_STUDIO_SESSIONS_API_SUFFIX,
  AI_STUDIO_SURFACE_ID,
  LOCAL_STUDIO_COMMAND_OPTIONS,
  SELECTED_SESSION_STORAGE_KEY,
  aiStudioSessionsQueryKey
} from "@/lib/aiStudioSessionRequestConfig.js";
import {
  aiStudioSessionFacts,
  aiStudioSessionLimits,
  buildAiStudioTimelineSteps,
  enrichAiStudioSessionForDisplay,
  shortAiStudioSessionId as shortSessionId,
  visibleAiStudioSessions
} from "@/lib/aiStudioSessionPanelModel.js";
import {
  aiStudioSessionDisplayTitle,
  aiStudioSessionStatusColor,
  aiStudioSessionStatusLabel,
  isClosedAiStudioSession
} from "@/lib/aiStudioSessionViewModel.js";

function useAiStudioSessionData({
  onTitleChange = null
} = {}) {
  const notifyTitleChange = typeof onTitleChange === "function" ? onTitleChange : () => null;
  const paths = usePaths();
  const sessionSelection = useStoredSelection({
    storageKey: SELECTED_SESSION_STORAGE_KEY
  });

  const selectedSessionId = sessionSelection.selectedId;
  const sessionsApiPath = computed(() => paths.api(AI_STUDIO_SESSIONS_API_SUFFIX, {
    surface: AI_STUDIO_SURFACE_ID
  }));

  const sessionList = useList({
    access: "never",
    apiSuffix: AI_STUDIO_SESSIONS_API_SUFFIX,
    fallbackLoadError: "AI Studio sessions could not be loaded.",
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "ai-studio.sessions.list",
    queryKeyFactory: aiStudioSessionsQueryKey,
    selectItems: (payload) => Array.isArray(payload?.sessions) ? payload.sessions : [],
    surfaceId: AI_STUDIO_SURFACE_ID
  });

  const createSessionCommand = useCommand({
    access: "never",
    apiSuffix: AI_STUDIO_SESSIONS_API_SUFFIX,
    buildRawPayload: (_model, { context }) => {
      const workflowProfile = String(context?.workflowProfile || "").trim();
      return workflowProfile ? { workflowProfile } : {};
    },
    buildCommandOptions: () => ({
      options: LOCAL_STUDIO_COMMAND_OPTIONS
    }),
    fallbackRunError: "AI Studio session could not be created.",
    messages: {
      error: "AI Studio session could not be created.",
      success: "AI Studio session created."
    },
    onRunSuccess: async (response) => {
      if (response?.sessionId) {
        selectSessionId(response.sessionId);
      }
      await refreshSessionData();
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "ai-studio.sessions.create",
    surfaceId: AI_STUDIO_SURFACE_ID,
    writeMethod: "POST"
  });

  const sessions = computed(() => visibleAiStudioSessions(sessionList.items || []));
  const creationOptions = computed(() => sessionList.pages?.[0]?.creation || {});
  const workflowProfiles = computed(() => {
    const profiles = creationOptions.value.workflowProfiles;
    return Array.isArray(profiles) ? profiles : [];
  });
  const createSessionMode = computed(() => {
    return creationOptions.value.mode === "select" && workflowProfiles.value.length > 0
      ? "select"
      : "direct";
  });
  const mainCheckoutSyncBlocker = computed(() => {
    return sessions.value.find(sessionNeedsMainCheckoutSync) || null;
  });
  const selectedListSession = computed(() => {
    return sessions.value.find((session) => session.sessionId === selectedSessionId.value) || null;
  });
  const selectedSession = computed(() => enrichAiStudioSessionForDisplay(selectedListSession.value));
  const isSelectedSessionClosed = computed(() => isClosedAiStudioSession(selectedSession.value || {}));
  const pageLoading = computed(() => Boolean(sessionList.isLoading));
  const limits = computed(() => aiStudioSessionLimits({
    payloadLimits: sessionList.pages?.[0]?.limits || {},
    sessions: sessions.value
  }));
  const canCreateSession = computed(() => {
    if (mainCheckoutSyncBlocker.value) {
      return false;
    }
    if (typeof creationOptions.value.canCreate === "boolean") {
      return creationOptions.value.canCreate;
    }
    return limits.value.openSessionCount < limits.value.maxOpenSessions;
  });
  const createSessionTitle = computed(() => {
    if (mainCheckoutSyncBlocker.value) {
      return `Sync the main checkout in session ${shortSessionId(mainCheckoutSyncBlocker.value.sessionId)} before creating another session.`;
    }
    if (creationOptions.value.disabledReason) {
      return String(creationOptions.value.disabledReason);
    }
    if (limits.value.openSessionCount >= limits.value.maxOpenSessions) {
      return `Studio allows up to ${limits.value.maxOpenSessions} active sessions.`;
    }
    return "Create a new AI Studio session";
  });
  const selectedSessionTitle = computed(() => {
    return aiStudioSessionDisplayTitle(selectedSession.value || {}) ||
      `Session ${shortSessionId(selectedSessionId.value)}`;
  });
  const timelineSteps = computed(() => buildAiStudioTimelineSteps(selectedSession.value));
  const sessionFacts = computed(() => aiStudioSessionFacts(selectedSession.value || {}));

  async function refreshSessionData() {
    await sessionList.reload();
  }

  function selectSessionId(sessionId = "") {
    sessionSelection.select(sessionId);
  }

  function clearSelectedSession() {
    sessionSelection.clear();
  }

  async function createSession(workflowProfile = "") {
    return createSessionCommand.run({
      workflowProfile
    });
  }

  watch(sessions, (nextSessions) => {
    if (sessionList.isInitialLoading) {
      return;
    }
    sessionSelection.selectAvailableId(nextSessions, {
      fallbackId: nextSessions.at(-1)?.sessionId || "",
      getId: (session) => session.sessionId
    });
  }, {
    immediate: true
  });

  watch(selectedSessionTitle, (title) => {
    notifyTitleChange(title || "");
  }, {
    immediate: true
  });

  return {
    canCreateSession,
    clearSelectedSession,
    createSession,
    createSessionCommand,
    createSessionMode,
    createSessionTitle,
    isSelectedSessionClosed,
    pageLoading,
    refreshSessionData,
    selectSessionId,
    selectedSession,
    selectedSessionId,
    selectedSessionTitle,
    sessionFacts,
    sessionList,
    sessions,
    sessionsApiPath,
    shortSessionId,
    statusColor: aiStudioSessionStatusColor,
    statusLabel: aiStudioSessionStatusLabel,
    timelineSteps,
    workflowProfiles
  };
}

function sessionNeedsMainCheckoutSync(session = {}) {
  const metadata = session.metadata || {};
  return String(metadata.pr_merged || "").trim() &&
    !String(metadata.main_checkout_synced || "").trim() &&
    !String(metadata.merge_skipped || "").trim();
}

export {
  useAiStudioSessionData
};
