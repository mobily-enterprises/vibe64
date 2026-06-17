import { computed, proxyRefs } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";
import {
  VIBE64_SURFACE_ID
} from "@/lib/vibe64RequestConfig.js";
import {
  PROJECT_SELECTION_ENDPOINT,
  VIBE64_PROJECT_CHANGED_EVENT,
  projectSelectionQueryKey
} from "@/lib/studioGateApi.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";
import {
  vibe64ResourceResponseError
} from "@/lib/vibe64ApiResponses.js";

function useVibe64ProjectsResource({
  projectSlug = "",
  fallbackLoadError = "Projects could not load.",
  requestRecoveryLabel = "Projects"
} = {}) {
  const slug = computed(() => normalizeText(readRefOrGetterValue(projectSlug)));
  const resource = useEndpointResource({
    fallbackLoadError,
    path: PROJECT_SELECTION_ENDPOINT,
    queryKey: computed(() => projectSelectionQueryKey(VIBE64_SURFACE_ID, ROUTE_VISIBILITY_PUBLIC, slug.value)),
    refreshOnPull: true,
    requestRecoveryLabel: requestRecoveryLabel,
    realtime: {
      event: VIBE64_PROJECT_CHANGED_EVENT
    }
  });
  const loadError = computed(() => vibe64ResourceResponseError(resource.data.value, fallbackLoadError) || resource.loadError.value);
  const currentProject = computed(() => resource.data.value?.currentProject || null);
  const projectsRoot = computed(() => String(resource.data.value?.projectsRoot || ""));
  const targetRoot = computed(() => String(resource.data.value?.targetRoot || ""));
  const projects = computed(() => Array.isArray(resource.data.value?.projects) ? resource.data.value.projects : []);
  const selfTargetAutoSelectProjectRepro = computed(() => {
    const config = resource.data.value?.repro?.selfTargetAutoSelectProject || {};
    return config && typeof config === "object" && !Array.isArray(config)
      ? config
      : {};
  });

  return proxyRefs({
    currentProject,
    data: resource.data,
    isFetching: resource.isFetching,
    isInitialLoading: resource.isInitialLoading,
    isLoading: resource.isLoading,
    isRefetching: resource.isRefetching,
    loadError,
    projects,
    projectsRoot,
    reload: resource.reload,
    resource,
    selfTargetAutoSelectProjectRepro,
    targetRoot
  });
}

function normalizeText(value = "") {
  return String(value || "").trim();
}

export {
  useVibe64ProjectsResource
};
