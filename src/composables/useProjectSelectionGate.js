import { computed, hasInjectionContext, onScopeDispose, proxyRefs, ref, watch } from "vue";
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
import { VIBE64_TRAINING_LEARNER_CHANGED_EVENT } from "@local/vibe64-training/shared/learner-events";
import { isPracticeProjectSlug } from "@/lib/vibe64PracticeProjectName.js";
import { VIBE64_LEARNING_MODE_PROJECT_CODE } from "@/lib/vibe64Learning.js";
import { useVibe64Learning } from "@/composables/useVibe64Learning.js";

const cachedProjectSelections = new Map();
// The server's not-found code for a practice project deleted while its page is open.
const PRACTICE_PROJECT_DELETED_CODE = "vibe64_practice_project_deleted";
// The server's refusal for a team member while the team AI setup has no Workspace-use model.
const TEAM_AI_REQUIRED_CODE = "vibe64_team_ai_required";

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
    // A routed practice page also re-reads its selection on the learner's
    // Practice archive or delete notice (reason "practice"), so an open page turns into
    // the deleted notice without a reload.
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

  // Learn mode (server-backed): the server lists no project of yours; the
  // picker says why and offers no project creation.
  const learning = hasInjectionContext() ? useVibe64Learning() : null;
  const learnMode = computed(() => learning?.learnMode === true);
  // A project the current mode does not allow was refused (the server's
  // message says which way to switch); the overlay's guard usually moves away first.
  const learningModeBlocked = computed(() =>
    selectionResource.query?.error?.value?.code === VIBE64_LEARNING_MODE_PROJECT_CODE);
  const learningModeMessage = computed(() => learningModeBlocked.value
    ? String(selectionResource.query.error.value.message || "") : "");

  // A team member's project waits for the owner's team AI setup.
  const teamAiBlocked = computed(() =>
    selectionResource.query?.error?.value?.code === TEAM_AI_REQUIRED_CODE);
  const teamAiOwnerName = computed(() => teamAiBlocked.value
    ? String(selectionResource.query.error.value.details?.ownerName || "") : "");

  const cachedProjectSelection = computed(() => cachedProjectSelections.get(projectSlug.value) || null);
  const projectSelection = computed(() => projectSelectionView.record || cachedProjectSelection.value || {});
  const projects = computed(() => Array.isArray(projectSelection.value.projects) ? projectSelection.value.projects : []);
  const projectsRoot = computed(() => String(projectSelection.value.projectsRoot || "~/vibe64"));
  const hasSelection = computed(() => projectSelection.value.hasSelection === true);
  // The owner's list: team members exist and cannot open projects yet.
  const teamAiOwnerPrompt = computed(() => {
    const teamAi = projectSelection.value.teamAi;
    return teamAi?.available === true && teamAi.memberCount > 0 && teamAi.ready !== true;
  });
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
    (learningModeBlocked.value || teamAiBlocked.value ? "" : projectSelectionView.loadError) ||
    saveError.value ||
    ""
  ));
  const practiceDeleted = computed(() => scopeSelectionToCurrentProject &&
    selectionResource.query?.error?.value?.code === PRACTICE_PROJECT_DELETED_CODE);

  watch([projectSelection, errorMessage, practiceDeleted, learningModeBlocked, teamAiBlocked], ([selection, error, deleted, blocked, teamBlocked]) => {
    if (blocked || teamBlocked) return;
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
    learnMode,
    learningModeBlocked,
    learningModeMessage,
    toggleMode: () => learning?.toggleMode(),
    loadProjectSelection,
    newProjectName,
    practiceDeleted,
    projectSelection,
    projects,
    projectsRoot,
    selectProject,
    selectingSlug,
    selectionInitialLoading,
    selectionReady,
    teamAiBlocked,
    teamAiOwnerName,
    teamAiOwnerPrompt
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

// Only the learner's practice.* commands (reason "practice") archive or delete
// the practice project a page shows; reading, step and learning-mode changes
// never do, and ordinary project pages ignore every Learning change.
function isPracticeNoticeForProject(payload = {}, slug = "") {
  return payload?.reason === "practice" && isPracticeProjectSlug(slug);
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
  TEAM_AI_REQUIRED_CODE,
  isPracticeNoticeForProject,
  projectSelectionGateEndpoint,
  projectSelectionGateQueryKey,
  useProjectSelectionGate
};
