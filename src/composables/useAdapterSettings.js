import { computed, proxyRefs } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";

import {
  useVibe64ProjectSlug
} from "@/composables/useVibe64ProjectScope.js";
import {
  VIBE64_SURFACE_ID
} from "@/lib/vibe64RequestConfig.js";
import {
  ADAPTER_SETTINGS_ENDPOINT,
  adapterSettingsQueryKey
} from "@/lib/studioGateApi.js";

function useAdapterSettings() {
  const projectSlug = useVibe64ProjectSlug();
  const resource = useEndpointResource({
    enabled: true,
    fallbackLoadError: "Adapter settings could not load.",
    path: ADAPTER_SETTINGS_ENDPOINT,
    queryKey: computed(() => adapterSettingsQueryKey(
      VIBE64_SURFACE_ID,
      ROUTE_VISIBILITY_PUBLIC,
      projectSlug.value
    )),
    refreshOnPull: true,
    requestRecoveryLabel: "Adapter settings"
  });

  return proxyRefs({
    isLoading: resource.isLoading,
    loadError: resource.loadError,
    refresh: resource.reload,
    resource,
    settings: computed(() => resource.data.value?.settings || null)
  });
}

export {
  useAdapterSettings
};
