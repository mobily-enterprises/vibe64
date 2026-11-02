import { watch } from "vue";
import { useRoute } from "vue-router";

/**
 * A request to show one provider (from a session, Colleague or a route): the
 * card's Manage when it has connections, else its connect step; a catalogue
 * provider with its revision, opencode or anything unknown goes to the key
 * editor, provider picker or Add a connection. Inline, a route naming a
 * provider without a catalogue revision opens its card once connections are
 * read (the manager opens revision-bearing ones).
 */
function useAiSetupProviderLinks({ inline, canConfigure, manager, cards, cardRows, openManage, connect }) {
  const route = useRoute();
  let routedProviderId = "";

  /** Shows one provider, by id, with an optional providerLabel and providerRevision. */
  function openProvider(providerId = "", options = {}) {
    const id = String(providerId || "").trim();
    const revision = Boolean(String(options.providerRevision || "").trim());
    const card = revision ? null : cards.value.find((item) => item.matches.native.includes(id) || item.matches.curated.includes(id));
    if (!card || !canConfigure.value) {
      manager.openProvider(id, options);
      return;
    }
    if (cardRows(card).length) openManage(card);
    else connect(card, "have");
  }

  watch(() => [inline.value ? String(route?.query?.providerId || "") : "", String(route?.query?.providerRevision || ""),
    manager.accountsInitialLoading.value], ([id, revision, loading]) => {
    if (!id || revision || loading || id === routedProviderId) return;
    routedProviderId = id;
    openProvider(id, { providerLabel: String(route.query.providerLabel || "") });
  }, { immediate: true });

  return { openProvider };
}

export { useAiSetupProviderLinks };
