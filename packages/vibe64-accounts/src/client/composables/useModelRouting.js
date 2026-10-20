import { computed, inject, unref } from "vue";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { ACCOUNTS_ENDPOINT, VIBE64_ACCOUNTS_CHANGED_EVENT, VIBE64_CONNECTIONS_CHANGED_EVENT } from "../lib/accountsGateApi.js";
import { VIBE64_ASSISTANT_VIEWER_KEY } from "/src/lib/vibe64AssistantHost.js";
import { vibe64ProjectQueryScope } from "/src/lib/vibe64ProjectScope.js";
import { ASSISTANT_ROUTING_ASSIGNMENTS } from "@local/vibe64-runtime/shared/assistantRouting";

function useModelRouting({ enabled = true, workflowsOnly = false, engineId = "", includeOtherModels = false } = {}) {
  const viewer = inject(VIBE64_ASSISTANT_VIEWER_KEY, { actorKey: "local" });
  const queryKey = computed(() => ["vibe64", ...vibe64ProjectQueryScope(unref(viewer)?.projectSlug),
    "model-routing", unref(viewer)?.actorKey || "signed-out", workflowsOnly ? "workflows" : "configuration",
    unref(engineId) || "all", includeOtherModels ? "all-models" : "assigned-models"]);
  const resource = useEndpointResource({
    enabled: computed(() => Boolean(unref(enabled) && unref(viewer)?.actorKey)),
    path: `${ACCOUNTS_ENDPOINT}/model-routing${workflowsOnly ? "/workflows" : ""}`,
    queryKey, realtime: { events: [VIBE64_ACCOUNTS_CHANGED_EVENT, VIBE64_CONNECTIONS_CHANGED_EVENT] },
    readQuery: computed(() => workflowsOnly ? {} : {
      ...(unref(engineId) ? { engineId: unref(engineId) } : {}),
      ...(includeOtherModels ? { includeOtherModels: true } : {})
    }),
    queryOptions: { refetchOnMount: true, staleTime: 30_000, retry: false },
    fallbackLoadError: "Model routing could not be loaded.", requestRecoveryLabel: "Model routing"
  });
  return { resource, scopeKey: computed(() => JSON.stringify(queryKey.value)), engines: computed(() => resource.data.value?.engines || []),
    workflows: computed(() => resource.data.value?.workflows || []),
    connectedWorkflows: computed(() => (resource.data.value?.workflows || []).filter((choice) => choice.connected)),
    loadError: computed(() => resource.loadError.value || (resource.data.value?.ok === false ? resource.data.value.error : "")) };
}

const routingChoiceKey = (selection) => JSON.stringify(["engineId", "agentId", "modelProviderId", "modelId", "variantId"]
  .map((key) => selection?.[key] || ""));

// True when the engine's recommendations would move a role onto this connection.
function routingSuggestsChanges(engine, connectionId) {
  return ASSISTANT_ROUTING_ASSIGNMENTS.some((role) => {
    const { assignment, recommendation } = engine?.roles?.[role] || {};
    return recommendation?.modelProviderId === connectionId && recommendation.engineId === engine.engineId &&
      routingChoiceKey(assignment) !== routingChoiceKey(recommendation);
  });
}

export { routingSuggestsChanges, useModelRouting };
