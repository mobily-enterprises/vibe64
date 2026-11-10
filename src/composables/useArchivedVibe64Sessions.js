import { computed, proxyRefs, ref, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import { useRoute } from "vue-router";
import {
  VIBE64_ARCHIVED_SESSIONS_API_SUFFIX,
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
  useArchivedVibe64ConversationHistory
} from "@/composables/useArchivedVibe64ConversationHistory.js";
import {
  enrichVibe64SessionForDisplay
} from "@/lib/vibe64SessionPanelModel.js";
import {
  isArchivedVibe64Session
} from "@/lib/vibe64SessionViewModel.js";
import {
  projectAppPath
} from "@/lib/vibe64ProjectScope.js";

const archivedVibe64SessionsEmits = ["loading-changed"];
// History lists the newest archived chats first, this many at a time; Show
// more lists the next ones. The archive grows with every chat ever archived.
const ARCHIVED_SESSIONS_PAGE_SIZE = 30;
// The most one list asks for (the server's sessionLimit bound).
const ARCHIVED_SESSIONS_MAX_LIMIT = 1000;
const archivedAtFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short"
});
const archivedVibe64SessionsProps = {
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

function useArchivedVibe64Sessions(emit) {
  const paths = usePaths();
  const projectSlug = useVibe64ProjectSlug();
  const sessionsApiPath = computed(() => paths.api(VIBE64_ARCHIVED_SESSIONS_API_SUFFIX, {
    surface: VIBE64_SURFACE_ID
  }));

  const shownLimit = ref(ARCHIVED_SESSIONS_PAGE_SIZE);
  watch(projectSlug, () => {
    shownLimit.value = ARCHIVED_SESSIONS_PAGE_SIZE;
  });
  const sessionListResource = useEndpointResource({
    fallbackLoadError: "Archived sessions could not be loaded.",
    path: sessionsApiPath,
    queryKey: computed(() => [
      ...vibe64SessionsQueryKey(
        VIBE64_SURFACE_ID,
        ROUTE_VISIBILITY_PUBLIC,
        projectSlug.value
      ),
      "archived",
      shownLimit.value
    ]),
    // Show more reads the longer list from the start, so a chat archived
    // meanwhile is neither skipped nor listed twice; the list stays on screen
    // while it does.
    queryOptions: {
      placeholderData: (previous) => previous
    },
    readQuery: computed(() => ({
      sessionLimit: String(shownLimit.value)
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
      .filter(isArchivedVibe64Session);
  });

  watch(loading, (isLoading) => {
    emit("loading-changed", isLoading);
  }, {
    immediate: true
  });

  const sessionCount = computed(() => Number(sessionListResource.data.value?.sessionCount ?? sessions.value.length));
  const hasMore = computed(() => (
    sessionListResource.data.value?.nextSessionOffset != null && shownLimit.value < ARCHIVED_SESSIONS_MAX_LIMIT
  ));

  function showMore() {
    if (!hasMore.value || loading.value) return;
    shownLimit.value = Math.min(shownLimit.value + ARCHIVED_SESSIONS_PAGE_SIZE, ARCHIVED_SESSIONS_MAX_LIMIT);
  }

  return {
    unavailableSessions: computed(() => sessionListResource.data.value?.unavailableSessions || []),
    error,
    hasMore,
    loadSessions,
    loading,
    sessionCount,
    showMore,
    formatArchivedAt,
    sessionRoute,
    sessions
  };

  async function loadSessions() {
    await sessionListResource.reload();
  }

  function sessionRoute(session = {}) {
    return archivedSessionDetailRoute({
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
    return isArchivedVibe64Session(enrichedSession) ? enrichedSession : null;
  });
  const backTo = computed(() => ({
    path: `${projectAppPath(projectSlug.value)}/dashboard/history`
  }));
  const conversationLog = proxyRefs(useArchivedVibe64ConversationHistory({
    active: computed(() => Boolean(session.value)),
    projectSlug,
    session,
    sessionsApiPath
  }));

  return {
    backTo,
    conversationLog,
    error: computed(() => String(sessionResource.loadError.value || "")),
    loading: computed(() => Boolean(sessionResource.isLoading.value || sessionResource.isInitialLoading?.value)),
    reload: sessionResource.reload,
    session,
    sessionId,
    sessionsApiPath,
    projectSlug
  };
}

function formatArchivedAt(value = "") {
  const date = new Date(String(value || ""));
  return Number.isNaN(date.getTime()) ? "time unavailable" : archivedAtFormatter.format(date);
}

function archivedSessionDetailRoute({
  projectSlug = "",
  sessionId = ""
} = {}) {
  return {
    path: `${projectAppPath(projectSlug)}/dashboard/history/${encodeURIComponent(String(sessionId || "").trim())}`
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
      icon: "$forkRight",
      label: "Branch",
      value: session.branch || metadataValue(session, "source_recovery_branch")
    },
    {
      icon: "$commit",
      label: "Head",
      value: metadataValue(session, "source_recovery_head") || metadataValue(session, "base_commit")
    },
    {
      icon: "$description",
      label: "Saved patch",
      value: metadataValue(session, "source_recovery_patch_artifact") || "No saved patch"
    },
    {
      icon: "$description",
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
  useArchivedVibe64Sessions,
  useArchivedVibe64SessionDetail
};
