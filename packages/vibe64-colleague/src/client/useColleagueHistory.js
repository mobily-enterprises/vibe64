import { computed, ref } from "vue";
import { mergeConversationLogPages, normalizeConversationLogPage } from "@jskit-ai/assistant-core/shared/conversation";

/** A history page read with no transcript waiting on it. */
function ignoreHistoryPageRead() {}

/**
 * Colleague's Previous conversations: the read-only list of archived
 * conversations and the pages of one of them, with its unconfirmed words.
 * A late answer for another person, a closed dialog or a newer read is dropped.
 * @param {object} options
 * @param {import("vue").ComputedRef<string>} options.actorKey
 * @param {(suffix: string, options: object) => Promise<object>} options.requestColleague
 * @param {() => boolean} options.isMounted
 */
function useColleagueHistory({ actorKey, requestColleague, isMounted }) {
  const historyOpen = ref(false);
  const historyLoading = ref(false);
  const historyError = ref("");
  const historyConversations = ref([]);
  const historyNextOffset = ref(null);
  const historyHasMore = ref(false);
  const historyId = ref("");
  const historyPages = ref([]);
  const historyUnconfirmed = ref([]);
  const historyUnconfirmedDelivery = ref(null);
  const historyTurns = computed(() => mergeConversationLogPages(historyPages.value).conversationLog);
  const historyPagination = computed(() => historyPages.value[0]?.pagination || {});
  let historyRevision = 0;
  function closeHistory() {
    historyRevision += 1;
    historyOpen.value = false;
    historyLoading.value = false;
    historyId.value = "";
    historyPages.value = [];
    historyConversations.value = [];
    historyUnconfirmed.value = [];
    historyUnconfirmedDelivery.value = null;
    historyError.value = "";
  }
  async function loadHistory({ more = false } = {}) {
    if (historyLoading.value) return;
    const expectedActor = actorKey.value;
    const expectedHistory = ++historyRevision;
    historyOpen.value = true;
    historyId.value = "";
    historyPages.value = [];
    historyUnconfirmed.value = [];
    historyUnconfirmedDelivery.value = null;
    historyLoading.value = true;
    historyError.value = "";
    try {
      const offset = more ? historyNextOffset.value : 0;
      const result = await requestColleague(`/conversations/history?offset=${offset}&limit=20`, { method: "GET" });
      if (!isMounted() || expectedActor !== actorKey.value || expectedHistory !== historyRevision || !historyOpen.value) return;
      historyConversations.value = more ? [...historyConversations.value, ...result.conversations] : result.conversations;
      historyNextOffset.value = result.nextOffset;
      historyHasMore.value = result.hasMore;
    } catch (error) {
      if (isMounted() && expectedActor === actorKey.value && expectedHistory === historyRevision) historyError.value = error.message;
    } finally {
      if (expectedHistory === historyRevision) historyLoading.value = false;
    }
  }
  async function readHistoryPage(conversationId, { more = false, complete = ignoreHistoryPageRead } = {}) {
    if (historyLoading.value) {
      complete({ changed: false });
      return;
    }
    let changed = false;
    const expectedActor = actorKey.value;
    const expectedHistory = ++historyRevision;
    const before = more ? historyPagination.value.nextBeforeTurnId : "";
    historyId.value = conversationId;
    if (!more) {
      historyPages.value = [];
      historyUnconfirmed.value = [];
      historyUnconfirmedDelivery.value = null;
    }
    historyLoading.value = true;
    historyError.value = "";
    try {
      const result = await requestColleague(`/conversations/history/page?conversationId=${encodeURIComponent(conversationId)}&limit=20${before ? `&beforeTurnId=${encodeURIComponent(before)}` : ""}`, { method: "GET" });
      if (!isMounted() || expectedActor !== actorKey.value || expectedHistory !== historyRevision || !historyOpen.value) return;
      if (result.id !== conversationId || result.readOnly !== true) throw new Error("The saved conversation response did not match this read-only history.");
      historyPages.value = [normalizeConversationLogPage(result), ...(more ? historyPages.value : [])];
      historyUnconfirmed.value = result.unconfirmedMessages || [];
      historyUnconfirmedDelivery.value = result.unconfirmedDelivery || null;
      changed = true;
    } catch (error) {
      if (isMounted() && expectedActor === actorKey.value && expectedHistory === historyRevision) historyError.value = error.message;
    } finally {
      if (expectedHistory === historyRevision) historyLoading.value = false;
      complete({ changed });
    }
  }
  return { historyOpen, historyLoading, historyError, historyConversations, historyHasMore, historyId, historyPages,
    historyUnconfirmed, historyUnconfirmedDelivery, historyTurns, historyPagination, closeHistory, loadHistory, readHistoryPage };
}

export { useColleagueHistory };
