import { computed, proxyRefs, ref, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";
import {
  VIBE64_SURFACE_ID
} from "@/lib/vibe64RequestConfig.js";
import {
  PROJECT_SELECTION_ENDPOINT,
  VIBE64_PROJECT_CREATE_API_SUFFIX,
  VIBE64_PROJECT_CHANGED_EVENT,
  VIBE64_PROJECT_SELECT_API_SUFFIX,
  projectSelectionQueryKey
} from "@/lib/studioGateApi.js";
import {
  scopedDevelopmentApiUrl
} from "@/lib/studioUrls.js";
import {
  useVibe64ProjectSlug
} from "@/composables/useVibe64ProjectScope.js";

const cachedProjectSelections = new Map();

function useProjectSelectionGate(emit, {
  scopeSelectionToCurrentProject = false
} = {}) {
  const creating = ref(false);
  const selectingSlug = ref("");
  const newProjectName = ref("");
  const projectSlug = useVibe64ProjectSlug();
  const selectionPath = computed(() => projectSelectionGateEndpoint({
    projectSlug: projectSlug.value,
    scopeSelectionToCurrentProject
  }));

  const selectionResource = useEndpointResource({
    fallbackLoadError: "Projects could not load.",
    path: selectionPath,
    queryKey: computed(() => projectSelectionGateQueryKey({
      ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
      projectSlug: projectSlug.value,
      scopeSelectionToCurrentProject,
      surfaceId: VIBE64_SURFACE_ID
    })),
    refreshOnPull: true,
    requestRecoveryLabel: "Projects",
    realtime: {
      event: VIBE64_PROJECT_CHANGED_EVENT
    }
  });

  const projectSelectionView = proxyRefs({
    isLoading: selectionResource.isLoading,
    loadError: selectionResource.loadError,
    record: selectionResource.data,
    refresh: selectionResource.reload
  });

  const createProjectCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_PROJECT_CREATE_API_SUFFIX,
    buildCommandOptions: () => ({
      method: "POST",
      path: PROJECT_SELECTION_ENDPOINT
    }),
    buildRawPayload: (_model, { context }) => ({
      name: context.name || ""
    }),
    fallbackRunError: "Project could not be created.",
    messages: {
      error: "Project could not be created.",
      success: "Project created."
    },
    onRunSuccess: loadProjectSelection,
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.projects.create",
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });

  const selectProjectCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_PROJECT_SELECT_API_SUFFIX,
    buildCommandOptions: () => ({
      method: "POST",
      path: `${PROJECT_SELECTION_ENDPOINT}/select`
    }),
    buildRawPayload: (_model, { context }) => ({
      slug: context.slug || ""
    }),
    fallbackRunError: "Project could not be selected.",
    messages: {
      error: "Project could not be selected.",
      success: "Project selected."
    },
    onRunSuccess: loadProjectSelection,
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.projects.select",
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });

  const cachedProjectSelection = computed(() => cachedProjectSelections.get(projectSlug.value) || null);
  const projectSelection = computed(() => projectSelectionView.record || cachedProjectSelection.value || {});
  const projects = computed(() => Array.isArray(projectSelection.value.projects) ? projectSelection.value.projects : []);
  const projectsRoot = computed(() => String(projectSelection.value.projectsRoot || "~/vibe64"));
  const hasSelection = computed(() => projectSelection.value.hasSelection === true);
  const selectionReady = computed(() => Boolean(projectSelectionView.record || cachedProjectSelection.value));
  const busy = computed(() => creating.value || Boolean(selectingSlug.value));
  const saveError = computed(() => {
    if (createProjectCommand.messageType === "error") {
      return String(createProjectCommand.message || "");
    }
    if (selectProjectCommand.messageType === "error") {
      return String(selectProjectCommand.message || "");
    }
    return "";
  });
  const errorMessage = computed(() => String(
    projectSelectionView.loadError ||
    saveError.value ||
    ""
  ));

  watch(projectSelection, (selection) => {
    if (selection && Object.keys(selection).length > 0) {
      cachedProjectSelections.set(projectSlug.value, selection);
    }
    if (selection?.hasSelection === true) {
      emit("ready", selection);
      return;
    }
    emit("missing", selection || {});
  }, {
    immediate: true
  });

  watch(errorMessage, (message) => {
    if (message) {
      emit("error", message);
    }
  });

  return {
    busy,
    createProject,
    creating,
    errorMessage,
    hasSelection,
    loadProjectSelection,
    newProjectName,
    projectSelection,
    projects,
    projectsRoot,
    selectProject,
    selectingSlug,
    selectionReady
  };

  async function loadProjectSelection() {
    await projectSelectionView.refresh();
  }

  async function createProject() {
    const name = newProjectName.value.trim();
    if (!name) {
      return;
    }
    creating.value = true;
    try {
      const response = await createProjectCommand.run({
        name
      });
      newProjectName.value = "";
      return String(response?.currentProject?.slug || "").trim();
    } finally {
      creating.value = false;
    }
  }

  async function selectProject(slug) {
    selectingSlug.value = String(slug || "");
    try {
      const response = await selectProjectCommand.run({
        slug: selectingSlug.value
      });
      return response ? selectingSlug.value : "";
    } finally {
      selectingSlug.value = "";
    }
  }
}

function projectSelectionGateEndpoint({
  projectSlug = "",
  scopeSelectionToCurrentProject = false
} = {}) {
  return scopeSelectionToCurrentProject
    ? scopedDevelopmentApiUrl(PROJECT_SELECTION_ENDPOINT, projectSlug, {
        scopeGlobalPaths: true
      })
    : PROJECT_SELECTION_ENDPOINT;
}

function projectSelectionGateQueryKey({
  ownershipFilter,
  projectSlug = "",
  scopeSelectionToCurrentProject = false,
  surfaceId
} = {}) {
  const baseKey = projectSelectionQueryKey(surfaceId, ownershipFilter, projectSlug);
  return scopeSelectionToCurrentProject
    ? [...baseKey, "route-selection"]
    : baseKey;
}

export {
  projectSelectionGateEndpoint,
  projectSelectionGateQueryKey,
  useProjectSelectionGate
};
