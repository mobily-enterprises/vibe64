import { computed, ref, unref } from "vue";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { ACCOUNTS_ENDPOINT, VIBE64_ACCOUNTS_CHANGED_EVENT } from "../lib/accountsGateApi.js";

function useCodexProviderConnections({ enabled = true } = {}) {
  const resource = useEndpointResource({
    enabled: computed(() => Boolean(unref(enabled))),
    path: `${ACCOUNTS_ENDPOINT}/codex-providers`,
    queryKey: ["vibe64", "codex-providers"],
    realtime: { event: VIBE64_ACCOUNTS_CHANGED_EVENT },
    queryOptions: { refetchOnMount: "always", retry: false },
    fallbackLoadError: "Codex provider connections could not be loaded.",
    requestRecoveryLabel: "Codex providers"
  });
  const busy = ref(false);
  const command = useCommand({
    access: "never",
    apiSuffix: "/vibe64/accounts/codex-providers",
    buildCommandOptions: (_model, { context }) => ({
      method: context.remove ? "POST" : "PATCH",
      path: `${ACCOUNTS_ENDPOINT}/codex-providers${context.remove ? "/remove" : ""}`
    }),
    buildRawPayload: (_model, { context }) => ({
      modelProviderId: context.modelProviderId,
      ...(!context.remove ? { apiKey: context.apiKey } : {})
    }),
    onRunSuccess(response) {
      if (response?.ok !== true) throw new Error(response?.error || "The connection could not be updated.");
    },
    fallbackRunError: "The Codex connection could not be updated.",
    messages: { success: "Codex connection updated.", error: "The Codex connection could not be updated." },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.accounts.codex-providers",
    surfaceId: "app",
    writeMethod: "PATCH"
  });
  async function change(input) {
    if (busy.value) return null;
    busy.value = true;
    try {
      const result = await command.run(input);
      if (result?.ok === true) await resource.reload();
      return result;
    } finally {
      busy.value = false;
    }
  }
  return {
    resource,
    busy,
    change,
    connections: computed(() => resource.data.value?.providers || []),
    loadError: computed(() => resource.loadError.value || (resource.data.value?.ok === false ? resource.data.value.error : ""))
  };
}

export { useCodexProviderConnections };
