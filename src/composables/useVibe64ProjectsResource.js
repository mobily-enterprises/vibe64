import { computed } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import {
  VIBE64_SURFACE_ID
} from "@/lib/vibe64RequestConfig.js";
import {
  PROJECT_SELECTION_ENDPOINT
} from "@/lib/studioGateApi.js";
import {
  projectSelectionGateQueryKey
} from "@/composables/useProjectSelectionGate.js";
import {
  scopedDevelopmentApiUrl
} from "@/lib/studioUrls.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";
import {
  vibe64ResourceResponseError
} from "@/lib/vibe64ApiResponses.js";

function useVibe64ProjectsResource({
  enabled = true,
  projectSlug = "",
  fallbackLoadError = "Projects could not load.",
  requestRecoveryLabel = "Projects"
} = {}) {
  const slug = computed(() => normalizeText(readRefOrGetterValue(projectSlug)));
  const selectionPath = computed(() => slug.value
    ? scopedDevelopmentApiUrl(PROJECT_SELECTION_ENDPOINT, slug.value, {
        scopeGlobalPaths: true
      })
    : PROJECT_SELECTION_ENDPOINT);
  const resource = useEndpointResource({
    enabled,
    fallbackLoadError,
    path: selectionPath,
    queryKey: computed(() => projectSelectionGateQueryKey({
      ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
      projectSlug: slug.value,
      scopeSelectionToCurrentProject: Boolean(slug.value),
      surfaceId: VIBE64_SURFACE_ID
    })),
    refreshOnPull: true,
    requestRecoveryLabel: requestRecoveryLabel
  });
  const loadError = computed(() => vibe64ResourceResponseError(resource.data.value, fallbackLoadError) || resource.loadError.value);
  const currentProject = computed(() => resource.data.value?.currentProject || null);
  const projectsRoot = computed(() => String(resource.data.value?.projectsRoot || ""));
  const targetRoot = computed(() => String(resource.data.value?.targetRoot || ""));
  const projects = computed(() => Array.isArray(resource.data.value?.projects) ? resource.data.value.projects : []);

  return {
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
    targetRoot
  };
}

function normalizeText(value = "") {
  return String(value || "").trim();
}

export {
  useVibe64ProjectsResource
};
