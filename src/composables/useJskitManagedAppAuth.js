import { computed } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import {
  useManagedAppAuthController
} from "@local/vibe64-accounts/client";

import {
  useVibe64ProjectSlug
} from "@/composables/useVibe64ProjectScope.js";
import {
  VIBE64_SURFACE_ID
} from "@/lib/vibe64RequestConfig.js";
import {
  ADAPTER_SETTINGS_ENDPOINT,
  adapterSettingsComponentQueryKey
} from "@/lib/studioGateApi.js";

const JSKIT_MANAGED_APP_AUTH_COMPONENT_ID = "jskit-managed-app-auth";
const JSKIT_MANAGED_APP_AUTH_COMPONENT_ENDPOINT = `${ADAPTER_SETTINGS_ENDPOINT}/components/${JSKIT_MANAGED_APP_AUTH_COMPONENT_ID}`;
const JSKIT_MANAGED_APP_AUTH_COMPONENT_API_SUFFIX = `/vibe64/adapter-settings/components/${JSKIT_MANAGED_APP_AUTH_COMPONENT_ID}`;

function useJskitManagedAppAuth() {
  const projectSlug = useVibe64ProjectSlug();
  return useManagedAppAuthController({
    apiSuffixBase: JSKIT_MANAGED_APP_AUTH_COMPONENT_API_SUFFIX,
    endpoints: {
      connect: `${JSKIT_MANAGED_APP_AUTH_COMPONENT_ENDPOINT}/connect`,
      disconnect: `${JSKIT_MANAGED_APP_AUTH_COMPONENT_ENDPOINT}/disconnect`,
      setup: `${JSKIT_MANAGED_APP_AUTH_COMPONENT_ENDPOINT}/setup`,
      smtpLogin: `${JSKIT_MANAGED_APP_AUTH_COMPONENT_ENDPOINT}/smtp-login`,
      smtpLoginDisconnect: `${JSKIT_MANAGED_APP_AUTH_COMPONENT_ENDPOINT}/smtp-login/disconnect`,
      status: JSKIT_MANAGED_APP_AUTH_COMPONENT_ENDPOINT,
      sync: `${JSKIT_MANAGED_APP_AUTH_COMPONENT_ENDPOINT}/sync`
    },
    fallbackLabel: "JSKIT Supabase Auth",
    placementSourceBase: "vibe64.jskit.supabase-auth",
    queryKey: computed(() => adapterSettingsComponentQueryKey(
      VIBE64_SURFACE_ID,
      ROUTE_VISIBILITY_PUBLIC,
      projectSlug.value,
      JSKIT_MANAGED_APP_AUTH_COMPONENT_ID
    ))
  });
}

export {
  JSKIT_MANAGED_APP_AUTH_COMPONENT_ID,
  useJskitManagedAppAuth
};
