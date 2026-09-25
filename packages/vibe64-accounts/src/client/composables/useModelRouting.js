import { computed, inject, unref } from "vue";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { ACCOUNTS_ENDPOINT, VIBE64_ACCOUNTS_CHANGED_EVENT, VIBE64_CONNECTIONS_CHANGED_EVENT } from "../lib/accountsGateApi.js";
import { VIBE64_ASSISTANT_VIEWER_KEY } from "/src/lib/vibe64AssistantHost.js";
import { vibe64ProjectQueryScope } from "/src/lib/vibe64ProjectScope.js";

function useModelRouting({ enabled = true, workflowsOnly = false } = {}) {
  const viewer = inject(VIBE64_ASSISTANT_VIEWER_KEY, { actorKey: "local" });
  const queryKey = computed(() => ["vibe64", ...vibe64ProjectQueryScope(unref(viewer)?.projectSlug),
    "model-routing", unref(viewer)?.actorKey || "signed-out", workflowsOnly ? "workflows" : "configuration"]);
  const resource = useEndpointResource({
    enabled: computed(() => Boolean(unref(enabled) && unref(viewer)?.actorKey)),
    path: `${ACCOUNTS_ENDPOINT}/model-routing${workflowsOnly ? "/workflows" : ""}`,
    queryKey, realtime: { events: [VIBE64_ACCOUNTS_CHANGED_EVENT, VIBE64_CONNECTIONS_CHANGED_EVENT] },
    queryOptions: { refetchOnMount: "always", retry: false },
    fallbackLoadError: "Model routing could not be loaded.", requestRecoveryLabel: "Model routing"
  });
  return { resource, scopeKey: computed(() => JSON.stringify(queryKey.value)), engines: computed(() => resource.data.value?.engines || []),
    loadError: computed(() => resource.loadError.value || (resource.data.value?.ok === false ? resource.data.value.error : "")) };
}

export { useModelRouting };
