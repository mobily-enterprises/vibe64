import { computed, toValue } from "vue";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";

import { STUDIO_TOOLS_ENDPOINT } from "@/lib/studioGateApi.js";

/**
 * Rows for the named tools (Stack runtime ids or AI tool ids), checked on this
 * computer only while `enabled` is true. Coming back to the tab checks again,
 * so a person who just installed a tool in a terminal sees it turn ready.
 * A host that supplies its own tools answers with no rows.
 */
export function useLocalToolRows(ids, { enabled = true } = {}) {
  const list = computed(() => [...new Set((toValue(ids) || []).map(String))]
    .filter((id) => /^[a-z0-9-]+$/u.test(id)).sort());
  const resource = useEndpointResource({
    enabled: computed(() => toValue(enabled) !== false && list.value.length > 0),
    fallbackLoadError: "The tool check could not run.",
    path: computed(() => (list.value.length ? `${STUDIO_TOOLS_ENDPOINT}?ids=${encodeURIComponent(list.value.join(","))}` : "")),
    queryKey: computed(() => ["vibe64", "studio-tools", list.value.join(",")]),
    queryOptions: { refetchOnWindowFocus: "always", staleTime: 0 },
    requestRecoveryLabel: "Tool check"
  });
  const tools = computed(() => (Array.isArray(resource.data.value?.tools) ? resource.data.value.tools : []));
  return {
    checking: resource.isFetching,
    check: () => resource.reload(),
    missing: computed(() => tools.value.filter((tool) => tool.status !== "ready")),
    tools
  };
}
