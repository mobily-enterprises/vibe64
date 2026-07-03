import { computed, proxyRefs, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";
import { usePaths } from "@jskit-ai/users-web/client/composables/usePaths";
import { useRoute } from "vue-router";
import {
  mdiArchiveCancelOutline,
  mdiCheckCircle,
  mdiEyeOutline,
  mdiFileDocumentOutline,
  mdiGithub,
  mdiRefresh,
  mdiSourceBranch,
  mdiSourceCommit
} from "@mdi/js";
import {
  VIBE64_SESSIONS_API_SUFFIX,
  VIBE64_SURFACE_ID,
  vibe64SessionPath,
  vibe64SessionQueryKey,
  vibe64SessionsQueryKey
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  useVibe64ProjectSlug
} from "@/composables/useVibe64ProjectScope.js";
import {
  useVibe64ConversationLog
} from "@/composables/useVibe64ConversationLog.js";
import {
  enrichVibe64SessionForDisplay
} from "@/lib/vibe64SessionPanelModel.js";
import {
  normalizeVibe64SessionArchiveTab,
  parseGithubSessionLink,
  shortVibe64SessionId,
  vibe64SessionArchive,
  vibe64SessionStatusColor,
  vibe64SessionStatusLabel
} from "@/lib/vibe64SessionViewModel.js";
import {
  projectAppPath
} from "@/lib/vibe64ProjectScope.js";

const archivedVibe64SessionsEmits = ["loading-changed"];
const archivedVibe64SessionsProps = {
  archive: {
    required: true,
    type: String
  },
  description: {
    default: "",
    type: String
  },
  emptyText: {
    default: "",
    type: String
  },
  emptyTitle: {
    default: "No sessions",
    type: String
  },
  showRefresh: {
    default: true,
    type: Boolean
  },
  title: {
    default: "",
    type: String
  }
};

function useArchivedVibe64Sessions(props, emit) {
  const paths = usePaths();
  const projectSlug = useVibe64ProjectSlug();
  const sessionsApiPath = computed(() => paths.api(VIBE64_SESSIONS_API_SUFFIX, {
    surface: VIBE64_SURFACE_ID
  }));

  const sessionListResource = useEndpointResource({
    fallbackLoadError: "Archived sessions could not be loaded.",
    path: sessionsApiPath,
    queryKey: computed(() => [
      ...vibe64SessionsQueryKey(
        VIBE64_SURFACE_ID,
        ROUTE_VISIBILITY_PUBLIC,
        projectSlug.value
      ),
      "archive",
      props.archive
    ]),
    readQuery: computed(() => ({
      archive: props.archive
    })),
    requestRecoveryLabel: "Archived sessions"
  });

  const loading = computed(() => Boolean(sessionListResource.isLoading.value));
  const error = computed(() => String(sessionListResource.loadError.value || ""));
  const sessions = computed(() => {
    const payload = sessionListResource.data.value;
    const items = Array.isArray(payload?.sessions) ? payload.sessions : [];
    return items
      .map(enrichVibe64SessionForDisplay)
      .filter(sessionIsInArchive);
  });

  const archiveIcon = computed(() => {
    return props.archive === "completed" ? mdiCheckCircle : mdiArchiveCancelOutline;
  });

  watch(loading, (isLoading) => {
    emit("loading-changed", isLoading);
  }, {
    immediate: true
  });

  return {
    archiveIcon,
    completedStepCount,
    error,
    githubLabel,
    loadSessions,
    loading,
    mdiEyeOutline,
    mdiGithub,
    mdiRefresh,
    mdiSourceBranch,
    sessionRoute,
    sessions,
    shortSessionId,
    statusColor,
    statusLabel
  };

  function sessionIsInArchive(session = {}) {
    const status = String(session.status || "");
    if (props.archive === "abandoned") {
      return status === "abandoned";
    }
    return status === "finished" || status === "completed";
  }

  async function loadSessions() {
    await sessionListResource.reload();
  }

  function sessionRoute(session = {}) {
    return archivedSessionDetailRoute({
      archive: props.archive,
      projectSlug: projectSlug.value,
      sessionId: session.sessionId
    });
  }
}

function useArchivedVibe64SessionDetail() {
  const route = useRoute();
  const paths = usePaths();
  const projectSlug = useVibe64ProjectSlug(route);
  const sessionId = computed(() => firstRouteParam(route.params.sessionId));
  const sessionsApiPath = computed(() => paths.api(VIBE64_SESSIONS_API_SUFFIX, {
    surface: VIBE64_SURFACE_ID
  }));
  const sessionPath = computed(() => sessionId.value
    ? vibe64SessionPath(sessionsApiPath.value, sessionId.value)
    : "");
  const sessionResource = useEndpointResource({
    enabled: computed(() => Boolean(sessionId.value)),
    fallbackLoadError: "Archived session could not be loaded.",
    path: sessionPath,
    queryKey: computed(() => [
      ...vibe64SessionQueryKey(
        VIBE64_SURFACE_ID,
        ROUTE_VISIBILITY_PUBLIC,
        projectSlug.value
      ),
      "archive-detail",
      sessionId.value
    ]),
    readQuery: computed(() => (projectSlug.value
      ? {
          projectSlug: projectSlug.value
        }
      : null)),
    requestRecoveryLabel: "Archived session"
  });
  const session = computed(() => {
    const payload = sessionResource.data.value;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return null;
    }
    if (String(payload.sessionId || "").trim() !== sessionId.value) {
      return null;
    }
    const enrichedSession = enrichVibe64SessionForDisplay(payload);
    return vibe64SessionArchive(enrichedSession) ? enrichedSession : null;
  });
  const archive = computed(() => vibe64SessionArchive(session.value) || normalizeVibe64SessionArchiveTab(route.query.tab));
  const backTo = computed(() => ({
    path: `${projectAppPath(projectSlug.value)}/dashboard/history`,
    query: {
      tab: archive.value
    }
  }));
  const conversationLog = proxyRefs(useVibe64ConversationLog({
    active: computed(() => Boolean(session.value)),
    session
  }));

  return {
    archive,
    backTo,
    conversationLog,
    error: computed(() => String(sessionResource.loadError.value || "")),
    loading: computed(() => Boolean(sessionResource.isLoading.value || sessionResource.isInitialLoading?.value)),
    mdiRefresh,
    reload: sessionResource.reload,
    session,
    sessionId
  };
}

function completedStepCount(session = {}) {
  const count = Number(session.completedStepCount);
  if (Number.isSafeInteger(count) && count >= 0) {
    return count;
  }
  return Array.isArray(session.completedSteps) ? session.completedSteps.length : 0;
}

function completedStepRows(session = {}) {
  return (Array.isArray(session.completedSteps) ? session.completedSteps : [])
    .map((step, index) => {
      if (step && typeof step === "object" && !Array.isArray(step)) {
        return {
          id: String(step.id || step.stepId || index + 1),
          label: String(step.label || step.title || step.id || step.stepId || `Step ${index + 1}`),
          message: String(step.message || step.description || "")
        };
      }
      const label = String(step || "").trim();
      return {
        id: label || String(index + 1),
        label: label || `Step ${index + 1}`,
        message: ""
      };
    });
}

function shortSessionId(sessionId) {
  return shortVibe64SessionId(sessionId);
}

function statusLabel(status) {
  return vibe64SessionStatusLabel(status);
}

function statusColor(status) {
  return vibe64SessionStatusColor(status);
}

function githubLabel(url, fallback) {
  return parseGithubSessionLink(url, fallback === "PR" ? "pr" : "issue").label;
}

function archivedSessionDetailRoute({
  archive = "completed",
  projectSlug = "",
  sessionId = ""
} = {}) {
  return {
    path: `${projectAppPath(projectSlug)}/dashboard/history/${encodeURIComponent(String(sessionId || "").trim())}`,
    query: {
      tab: normalizeVibe64SessionArchiveTab(archive)
    }
  };
}

function firstRouteParam(value) {
  return String(Array.isArray(value) ? value[0] : value || "").trim();
}

function metadataValue(session = {}, name = "") {
  return String(session.metadata?.[name] || "").trim();
}

function archiveFactRows(session = {}) {
  return [
    {
      icon: mdiSourceBranch,
      label: "Branch",
      value: session.branch || metadataValue(session, "source_recovery_branch")
    },
    {
      icon: mdiSourceCommit,
      label: "Head",
      value: metadataValue(session, "source_recovery_head") || metadataValue(session, "base_commit")
    },
    {
      icon: mdiFileDocumentOutline,
      label: "Saved patch",
      value: metadataValue(session, "source_recovery_patch_artifact") || "No saved patch"
    },
    {
      icon: mdiFileDocumentOutline,
      label: "Untracked files",
      value: metadataValue(session, "source_recovery_untracked_artifact") || "No saved untracked archive"
    }
  ].filter((row) => row.value);
}

export {
  archiveFactRows,
  archivedSessionDetailRoute,
  archivedVibe64SessionsEmits,
  archivedVibe64SessionsProps,
  completedStepRows,
  shortSessionId,
  useArchivedVibe64Sessions,
  useArchivedVibe64SessionDetail
};
