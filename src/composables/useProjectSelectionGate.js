import { computed, onScopeDispose, proxyRefs, ref, watch } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
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
import {
  useVibe64PracticeProjects
} from "@/composables/useVibe64PracticeProjects.js";
import { VIBE64_TRAINING_LEARNER_CHANGED_EVENT } from "@local/vibe64-training/shared/learner-events";
import { projectDisplayName } from "@/lib/vibe64PracticeProjectName.js";

const cachedProjectSelections = new Map();
// The server's not-found code for a practice project deleted while its page is open.
const PRACTICE_PROJECT_DELETED_CODE = "vibe64_practice_project_deleted";

function useProjectSelectionGate(emit, {
  scopeSelectionToCurrentProject = false,
  showPractice = false
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
    // A routed practice page also re-reads its selection when Learning
    // deletes that practice project (the learner's own "practice" notice), so
    // an open page turns into the deleted notice without a reload. Hosted
    // project-page deletes already publish the project-changed event.
    realtime: scopeSelectionToCurrentProject ? {
      events: [VIBE64_PROJECT_CHANGED_EVENT, VIBE64_TRAINING_LEARNER_CHANGED_EVENT],
      matches: ({ event, payload } = {}) => event !== VIBE64_TRAINING_LEARNER_CHANGED_EVENT ||
        isPracticeNoticeForProject(payload, projectSlug.value)
    } : {
      event: VIBE64_PROJECT_CHANGED_EVENT
    }
  });
  if (scopeSelectionToCurrentProject) rereadSelectionWhenProjectDeleted();

  const projectSelectionView = proxyRefs({
    isInitialLoading: selectionResource.isInitialLoading,
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
  const listedProjects = computed(() => Array.isArray(projectSelection.value.projects) ? projectSelection.value.projects : []);
  // Practice is split at presentation: the listing stays unfiltered.
  const projects = computed(() => listedProjects.value.filter((project) => !project?.practice));
  // Standalone practice projects live outside the projects folder; their
  // source is the learner's own saved lessons (learning.read).
  const practice = useVibe64PracticeProjects({ enabled: showPractice });
  const practiceProjects = computed(() => showPractice ? practice.practiceProjects.value
    : listedProjects.value.filter((project) => project?.practice).map((project) => ({
      slug: project.slug,
      attemptId: String(project.practice.attemptId || ""),
      lessonCode: String(project.practice.lessonCode || ""),
      lessonTitle: "",
      name: projectDisplayName(project),
      ended: false,
      mine: project.practice.mine === true,
      // The hosted host owns its delete (Online management page); the shared
      // picker only lists and opens these.
      deleteAvailable: false
    })));
  const projectsRoot = computed(() => String(projectSelection.value.projectsRoot || "~/vibe64"));
  const hasSelection = computed(() => projectSelection.value.hasSelection === true);
  const selectionReady = computed(() => Boolean(projectSelectionView.record || cachedProjectSelection.value));
  const selectionInitialLoading = computed(() => Boolean(
    projectSelectionView.isInitialLoading && !selectionReady.value
  ));
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
  const practiceDeleted = computed(() => scopeSelectionToCurrentProject &&
    selectionResource.query?.error?.value?.code === PRACTICE_PROJECT_DELETED_CODE);

  watch([projectSelection, errorMessage, practiceDeleted], ([selection, error, deleted]) => {
    if (deleted) {
      // The open practice project was deleted: no cached selection reopens it.
      cachedProjectSelections.delete(projectSlug.value);
      emit("deleted");
      return;
    }
    if (selection && Object.keys(selection).length > 0) {
      cachedProjectSelections.set(projectSlug.value, selection);
    }
    if (error) {
      emit("error", error);
      return;
    }
    if (selection?.hasSelection === true) {
      emit("ready", selection);
      return;
    }
    emit("missing", selection || {});
  }, {
    immediate: true
  });

  return {
    busy,
    createProject,
    creating,
    errorMessage,
    hasSelection,
    loadProjectSelection,
    newProjectName,
    deletePracticeProject: practice.deletePracticeProject,
    deletingPracticeSlug: practice.deletingSlug,
    practiceDeleted,
    practiceProjects,
    projectSelection,
    projects,
    projectsRoot,
    selectProject,
    selectingSlug,
    selectionInitialLoading,
    selectionReady
  };

  // Any other request of the open page (sessions, chat, files) that is refused
  // with the deleted code makes the gate re-read its own selection, which then
  // shows the deleted notice when this project is the one that was deleted.
  function rereadSelectionWhenProjectDeleted() {
    const unsubscribe = useQueryClient().getQueryCache().subscribe((cacheEvent) => {
      if (cacheEvent.type !== "updated" || cacheEvent.action?.type !== "error" ||
        cacheEvent.action.error?.code !== PRACTICE_PROJECT_DELETED_CODE || practiceDeleted.value) return;
      if (cacheEvent.query?.queryHash === selectionQueryHash()) return;
      void loadProjectSelection().catch(() => {});
    });
    onScopeDispose(unsubscribe);
  }

  function selectionQueryHash() {
    return JSON.stringify(projectSelectionGateQueryKey({
      ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
      projectSlug: projectSlug.value,
      scopeSelectionToCurrentProject,
      surfaceId: VIBE64_SURFACE_ID
    }));
  }

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

// Learning's practice notice names the attempt; a practice project's slug is
// training-<attempt id without dashes>.
function isPracticeNoticeForProject(payload = {}, slug = "") {
  const attemptId = String(payload?.attemptId || "").replaceAll("-", "");
  return payload?.reason === "practice" && Boolean(attemptId) && String(slug || "") === `training-${attemptId}`;
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
  PRACTICE_PROJECT_DELETED_CODE,
  isPracticeNoticeForProject,
  projectSelectionGateEndpoint,
  projectSelectionGateQueryKey,
  useProjectSelectionGate
};
