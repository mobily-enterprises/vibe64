import { computed, inject, unref } from "vue";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { ACCOUNTS_ENDPOINT, VIBE64_ACCOUNTS_CHANGED_EVENT, VIBE64_CONNECTIONS_CHANGED_EVENT } from "../lib/accountsGateApi.js";
import { VIBE64_ASSISTANT_VIEWER_KEY } from "/src/lib/vibe64AssistantHost.js";
import { vibe64ProjectQueryScope } from "/src/lib/vibe64ProjectScope.js";

// The workspace AI setup: the owner's and the team setup, with every
// connected tool's choices and illustrative decisions.
function useModelRouting({ enabled = true } = {}) {
  const viewer = inject(VIBE64_ASSISTANT_VIEWER_KEY, { actorKey: "local" });
  const queryKey = computed(() => ["vibe64", ...vibe64ProjectQueryScope(unref(viewer)?.projectSlug),
    "model-routing", unref(viewer)?.actorKey || "signed-out"]);
  const resource = useEndpointResource({
    enabled: computed(() => Boolean(unref(enabled) && unref(viewer)?.actorKey)),
    path: `${ACCOUNTS_ENDPOINT}/model-routing`,
    queryKey, realtime: { events: [VIBE64_ACCOUNTS_CHANGED_EVENT, VIBE64_CONNECTIONS_CHANGED_EVENT] },
    queryOptions: { refetchOnMount: true, staleTime: 30_000, retry: false },
    fallbackLoadError: "Models could not be loaded.", requestRecoveryLabel: "Models"
  });
  const engines = computed(() => resource.data.value?.engines || []);
  return { resource, scopeKey: computed(() => JSON.stringify(queryKey.value)), engines,
    connectedEngines: computed(() => engines.value.filter((engine) => engine.connected)),
    setups: computed(() => resource.data.value?.setups || null),
    viewerDecisions: computed(() => resource.data.value?.viewer || {}),
    team: computed(() => resource.data.value?.team || { available: false, ownerName: "", memberCount: 0 }),
    loadError: computed(() => resource.loadError.value || (resource.data.value?.ok === false ? resource.data.value.error : "")) };
}

export { useModelRouting };
