import { computed, inject, unref } from "vue";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { ACCOUNTS_ENDPOINT, VIBE64_ACCOUNTS_CHANGED_EVENT, VIBE64_CONNECTIONS_CHANGED_EVENT } from "../lib/accountsGateApi.js";
import { VIBE64_ASSISTANT_VIEWER_KEY } from "/src/lib/vibe64AssistantHost.js";
import { vibe64ProjectQueryScope } from "/src/lib/vibe64ProjectScope.js";
import { ASSISTANT_SETUP_ROLES } from "@local/vibe64-runtime/shared/assistantRouting";

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
    fallbackLoadError: "Model routing could not be loaded.", requestRecoveryLabel: "Model routing"
  });
  const engines = computed(() => resource.data.value?.engines || []);
  return { resource, scopeKey: computed(() => JSON.stringify(queryKey.value)), engines,
    connectedEngines: computed(() => engines.value.filter((engine) => engine.connected)),
    setups: computed(() => resource.data.value?.setups || null),
    viewerDecisions: computed(() => resource.data.value?.viewer || {}),
    team: computed(() => resource.data.value?.team || { available: false, ownerName: "", memberCount: 0 }),
    loadError: computed(() => resource.loadError.value || (resource.data.value?.ok === false ? resource.data.value.error : "")) };
}

const routingChoiceKey = (selection) => JSON.stringify(["engineId", "agentId", "modelProviderId", "modelId", "variantId"]
  .map((key) => selection?.[key] || ""));

// True when the owner setup's recommendations would move a role onto this connection.
function routingSuggestsChanges(setups, connectionId) {
  return ASSISTANT_SETUP_ROLES.owner.some((role) => {
    const { value, recommendation } = setups?.owner?.roles?.[role] || {};
    return recommendation?.schema && recommendation.modelProviderId === connectionId &&
      routingChoiceKey(value) !== routingChoiceKey(recommendation);
  });
}

export { routingSuggestsChanges, useModelRouting };
