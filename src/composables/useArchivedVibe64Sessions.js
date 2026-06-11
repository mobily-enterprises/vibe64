import { computed, ref, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";
import { usePaths } from "@jskit-ai/users-web/client/composables/usePaths";
import {
  mdiArchiveCancelOutline,
  mdiCheckCircle,
  mdiGithub,
  mdiRefresh,
  mdiRestore,
  mdiSourceBranch
} from "@mdi/js";
import {
  VIBE64_SESSIONS_API_SUFFIX,
  VIBE64_SURFACE_ID,
  vibe64SessionPath,
  vibe64SessionsQueryKey
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  useVibe64ProjectSlug
} from "@/composables/useVibe64ProjectScope.js";
import {
  enrichVibe64SessionForDisplay
} from "@/lib/vibe64SessionPanelModel.js";
import {
  parseGithubSessionLink,
  shortVibe64SessionId,
  vibe64SessionStatusColor,
  vibe64SessionStatusLabel
} from "@/lib/vibe64SessionViewModel.js";

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
  const recoverError = ref("");
  const recoverMessage = ref("");
  const recoveringSessionIds = ref(new Set());
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
  const recoverWorktreeCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_SESSIONS_API_SUFFIX,
    buildCommandOptions: (_model, { context }) => ({
      method: "POST",
      path: vibe64SessionPath(sessionsApiPath.value, context.sessionId, "/worktree/recover")
    }),
    buildRawPayload: () => ({}),
    fallbackRunError: "Worktree could not be recovered.",
    messages: {
      error: "Worktree could not be recovered.",
      success: "Worktree recovered."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.sessions.recover-worktree",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
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
    hasDetails,
    loadSessions,
    loading,
    mdiGithub,
    mdiRefresh,
    mdiRestore,
    mdiSourceBranch,
    recoverError,
    recoverMessage,
    recoverWorktree,
    sessions,
    sessionIsRecovering,
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

  function sessionIsRecovering(sessionId = "") {
    return recoveringSessionIds.value.has(String(sessionId || ""));
  }

  function setSessionRecovering(sessionId = "", recovering = false) {
    const next = new Set(recoveringSessionIds.value);
    if (recovering) {
      next.add(sessionId);
    } else {
      next.delete(sessionId);
    }
    recoveringSessionIds.value = next;
  }

  async function recoverWorktree(session = {}) {
    const sessionId = String(session.sessionId || "");
    if (!sessionId || sessionIsRecovering(sessionId)) {
      return;
    }
    recoverError.value = "";
    recoverMessage.value = "";
    setSessionRecovering(sessionId, true);
    try {
      const recovered = await recoverWorktreeCommand.run({
        sessionId
      });
      const name = recovered?.sessionName || session.worktreeRecoveryName || shortSessionId(sessionId);
      recoverMessage.value = `Recovered worktree for ${name}.`;
      await loadSessions();
    } catch (error) {
      recoverError.value = String(error?.message || error || "Worktree could not be recovered.");
    } finally {
      setSessionRecovering(sessionId, false);
    }
  }
}

function completedStepCount(session = {}) {
  const count = Number(session.completedStepCount);
  if (Number.isSafeInteger(count) && count >= 0) {
    return count;
  }
  return Array.isArray(session.completedSteps) ? session.completedSteps.length : 0;
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

function hasDetails(session = {}) {
  return Boolean(session.finalReportText);
}

export {
  archivedVibe64SessionsEmits,
  archivedVibe64SessionsProps,
  useArchivedVibe64Sessions
};
