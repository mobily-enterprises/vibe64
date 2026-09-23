import { computed, unref } from "vue";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { ACCOUNTS_ENDPOINT, VIBE64_ACCOUNTS_CHANGED_EVENT } from "../lib/accountsGateApi.js";

function useModelRouting({ enabled = true } = {}) {
  const resource = useEndpointResource({
    enabled: computed(() => Boolean(unref(enabled))), path: `${ACCOUNTS_ENDPOINT}/model-routing`,
    queryKey: ["vibe64", "model-routing"], realtime: { event: VIBE64_ACCOUNTS_CHANGED_EVENT },
    queryOptions: { refetchOnMount: "always", retry: false },
    fallbackLoadError: "Model routing could not be loaded.", requestRecoveryLabel: "Model routing"
  });
  return { resource, engines: computed(() => resource.data.value?.engines || []),
    loadError: computed(() => resource.loadError.value || (resource.data.value?.ok === false ? resource.data.value.error : "")) };
}

export { useModelRouting };
