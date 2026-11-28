import { computed, onScopeDispose, unref, watch } from "vue";
import { projectSlugFromRoute } from "@/lib/vibe64ProjectScope.js";
import { sessionIdExistsInList } from "@/lib/vibe64SessionListLookup.js";
import { selectedSessionIdFromRoute } from "@/composables/useVibe64SessionSelection.js";

/**
 * The query an address on the project page takes so it names the session on screen, or null to keep it. A
 * ?session= naming another session than the one shown gets the shown one, a session this project lists, or
 * none when the page shows none, and loses the previous session's chat (?conversation=, ?chat=). An address
 * without a session keeps none: the project then opens the person's last opened session, which the selection
 * publishes. A shown session the list does not name yet (a new session, a link still checking its renewal)
 * waits for the list, and a route that already shows another project keeps its address. A renewal goes on with
 * the same work in its successor: an address naming the renewed session, gone from the list, moves only to the
 * successor its renewal confirms, and with the same chat.
 * @param {{
 *   route?: { params?: Record<string, unknown>, query?: Record<string, unknown> },
 *   projectSlug?: string,
 *   renewal?: { fromId?: string, confirmed?: boolean },
 *   shownSessionId?: string,
 *   sessions?: Array<{ sessionId: string }>
 * }} options renewal: the session the shown one was renewed from, and whether its renewal confirms the shown one
 *   as its successor (useVibe64SelectedSessionRenewal).
 * @returns {Record<string, unknown> | null}
 */
function sessionAddressQuery({ route = {}, projectSlug = "", renewal = {}, shownSessionId = "", sessions = [] } = {}) {
  const addressSessionId = selectedSessionIdFromRoute(route);
  const shownId = String(shownSessionId || "").trim();
  if (!addressSessionId || addressSessionId === shownId || projectSlugFromRoute(route) !== projectSlug) return null;
  if (shownId && !sessionIdExistsInList(shownId, sessions)) return null;
  const renewedAddress = Boolean(renewal.fromId) && renewal.fromId === addressSessionId &&
    !sessionIdExistsInList(addressSessionId, sessions);
  if (renewedAddress) return renewal.confirmed === true ? { ...route.query, session: shownId } : null;
  const { session: _session, conversation: _conversation, chat: _chat, ...query } = route.query || {};
  return shownId ? { ...query, session: shownId } : query;
}

/**
 * The project page's one writer of the address's ?session=: whenever its selection moves (a session tab, a new
 * session, an archive, the fallback for a session that has gone, a renewal's successor), the address is
 * replaced so it names the session shown, as a host's Colleague navigation replaces it for the chat shown. An
 * address that moves (a link, Back, a navigation) leads instead, and the selection follows it
 * (useStoredSelection), so a reload, a copied link or the address opened again shows what was on screen. A
 * change still pending when the page closes or the project changes is cancelled, so it cannot overwrite the newer
 * address.
 * @param {{
 *   projectSlug: import("vue").Ref<string>,
 *   renewal: { fromId: import("vue").Ref<string>, confirmed: import("vue").Ref<boolean> },
 *   route: import("vue-router").RouteLocationNormalizedLoaded,
 *   router: import("vue-router").Router,
 *   selectedSessionId: import("vue").Ref<string>,
 *   sessions: import("vue").Ref<Array<{ sessionId: string }>>
 * }} options
 */
function useVibe64SessionAddress({ projectSlug, renewal, route, router, selectedSessionId, sessions }) {
  let closed = false;
  onScopeDispose(() => {
    closed = true;
  });
  const currentProject = () => String(unref(projectSlug) || "").trim();
  function replaceAddress(target) {
    const project = currentProject();
    const targetUrl = router.resolve(target).fullPath;
    const removeGuard = router.beforeResolve((to) => to.fullPath !== targetUrl || (!closed && currentProject() === project));
    void router.replace(target).catch(() => null).finally(removeGuard);
  }
  const addressSessionId = computed(() => selectedSessionIdFromRoute(route));
  const shownListed = computed(() => sessionIdExistsInList(selectedSessionId.value, sessions.value));
  const shownRenewal = computed(() => ({ fromId: renewal.fromId.value, confirmed: renewal.confirmed.value }));
  watch([selectedSessionId, shownListed, addressSessionId, shownRenewal], (_next, [, , previousAddressSessionId]) => {
    if (addressSessionId.value !== previousAddressSessionId) return;
    const query = sessionAddressQuery({
      route,
      projectSlug: currentProject(),
      renewal: shownRenewal.value,
      shownSessionId: selectedSessionId.value,
      sessions: sessions.value
    });
    if (query) replaceAddress({ path: route.path, hash: route.hash, query });
  });
}

export {
  sessionAddressQuery,
  useVibe64SessionAddress
};
