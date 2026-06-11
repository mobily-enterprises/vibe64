import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";
import {
  AUTH_SUPABASE_CONFIG_ENDPOINT
} from "@/lib/vibe64AuthApi.js";
import {
  createVibe64SupabaseClient
} from "@/lib/vibe64SupabaseAuth.js";

let clientPromise = null;

function useVibe64SupabaseAuth() {
  const supabaseConfigResource = useEndpointResource({
    enabled: false,
    fallbackLoadError: "Supabase auth config could not load.",
    path: AUTH_SUPABASE_CONFIG_ENDPOINT,
    queryKey: ["vibe64", "auth", "supabase-config"],
    requestRecoveryLabel: "Supabase auth config"
  });

  async function vibe64SupabaseClient() {
    if (!clientPromise) {
      clientPromise = loadSupabaseClient().catch((error) => {
        clientPromise = null;
        throw error;
      });
    }
    return clientPromise;
  }

  async function loadSupabaseClient() {
    const result = await supabaseConfigResource.reload();
    const response = result?.data || supabaseConfigResource.data.value || {};
    return createVibe64SupabaseClient(response);
  }

  return {
    supabaseConfigLoadError: supabaseConfigResource.loadError,
    supabaseConfigLoading: supabaseConfigResource.isLoading,
    vibe64SupabaseClient
  };
}

export {
  useVibe64SupabaseAuth
};
