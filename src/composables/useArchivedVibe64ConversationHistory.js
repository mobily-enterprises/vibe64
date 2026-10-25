import { computed, ref, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import {
  CONVERSATION_LOG_PAGE_LIMIT,
  conversationLogReadQuery,
  mergeConversationLogPages,
  normalizeConversationLogPage,
  normalizeConversationLogPagination
} from "@jskit-ai/assistant-core/shared/conversation";
import { normalizeConversationLog } from "@/composables/useVibe64ConversationLog.js";
import {
  VIBE64_SURFACE_ID,
  vibe64ConversationLogPath,
  vibe64ConversationLogQueryKey
} from "@/lib/vibe64SessionRequestConfig.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";

// An archived session's saved history: read once, page back on request. It has
// no live turn, stream or patches, so nothing here subscribes to realtime.
function useArchivedVibe64ConversationHistory({ active = true, projectSlug, session, sessionsApiPath } = {}) {
  const httpClient = getHttpWebClient();
  const sessionId = computed(() => String(readRefOrGetterValue(session)?.sessionId || "").trim());
  const enabled = computed(() => readRefOrGetterValue(active) !== false && Boolean(sessionId.value));
  const path = computed(() => sessionId.value
    ? vibe64ConversationLogPath(readRefOrGetterValue(sessionsApiPath), sessionId.value) : "");
  const resource = useEndpointResource({
    enabled,
    fallbackLoadError: "Conversation history could not be loaded.",
    path,
    queryKey: computed(() => vibe64ConversationLogQueryKey(VIBE64_SURFACE_ID, ROUTE_VISIBILITY_PUBLIC,
      sessionId.value, readRefOrGetterValue(projectSlug))),
    queryOptions: {
      queryFn: ({ signal }) => httpClient.request(path.value, { method: "GET", query: conversationLogReadQuery(), signal }),
      placeholderData: (previousData) => previousData,
      refetchOnMount: false,
      refetchOnWindowFocus: false
    },
    readMethod: "GET",
    refreshOnPull: true,
    requestRecoveryLabel: "Conversation history",
    realtime: null
  });
  const olderPages = ref([]);
  const loadingMore = ref(false);
  const loadMoreError = ref("");
  const latestPage = computed(() => normalizeConversationLogPage(resource.data.value || {}));
  const oldestLoadedPage = computed(() => olderPages.value[0] || latestPage.value);
  const hasMoreBefore = computed(() => Boolean(
    normalizeConversationLogPagination(oldestLoadedPage.value?.pagination).hasMoreBefore
  ));
  const turns = computed(() => normalizeConversationLog(mergeConversationLogPages([...olderPages.value, latestPage.value])));

  function reload() {
    olderPages.value = [];
    loadMoreError.value = "";
    return resource.reload();
  }

  async function loadMore({ complete } = {}) {
    const finish = (result) => { if (typeof complete === "function") complete(result); };
    const pagination = normalizeConversationLogPagination(oldestLoadedPage.value?.pagination);
    const beforeTurnId = pagination.nextBeforeTurnId || pagination.oldestTurnId || String(turns.value[0]?.turnId || "").trim();
    if (!enabled.value || !path.value || !hasMoreBefore.value || loadingMore.value || !beforeTurnId) {
      finish({ changed: false, loaded: false });
      return false;
    }
    const requestedSessionId = sessionId.value;
    loadingMore.value = true;
    loadMoreError.value = "";
    try {
      const page = await httpClient.request(path.value, {
        method: "GET",
        query: conversationLogReadQuery({ beforeTurnId, limit: CONVERSATION_LOG_PAGE_LIMIT })
      });
      if (sessionId.value !== requestedSessionId) {
        finish({ changed: false, loaded: false });
        return false;
      }
      const messageCount = () => turns.value.reduce((count, turn) => count + (turn.messages?.length || 0), 0);
      const previousOldestTurnId = String(turns.value[0]?.turnId || "").trim();
      const previousMessageCount = messageCount();
      olderPages.value = [normalizeConversationLogPage(page), ...olderPages.value];
      const nextOldestTurnId = String(turns.value[0]?.turnId || "").trim();
      finish({ changed: Boolean(nextOldestTurnId &&
        (nextOldestTurnId !== previousOldestTurnId || messageCount() !== previousMessageCount)), loaded: true });
      return true;
    } catch (error) {
      if (sessionId.value === requestedSessionId) {
        loadMoreError.value = String(error?.message || error || "Older conversation history could not be loaded.");
      }
      finish({ changed: false, loaded: false });
      return false;
    } finally {
      loadingMore.value = false;
    }
  }

  watch(sessionId, () => {
    olderPages.value = [];
    loadMoreError.value = "";
  });

  return {
    error: resource.loadError,
    hasMoreBefore,
    loadMore,
    loadMoreError,
    loading: resource.isLoading,
    loadingMore,
    reload,
    turns
  };
}

export { useArchivedVibe64ConversationHistory };
