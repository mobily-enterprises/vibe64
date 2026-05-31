<template>
  <div class="project-selection-gate">
    <StudioErrorNotice
      v-if="errorMessage"
      title="Projects could not load"
      :error="errorMessage"
      compact
    />

    <v-progress-linear
      v-if="showLoadingBar"
      color="primary"
      height="6"
      indeterminate
      rounded
    />

    <slot
      v-else-if="hasSelection"
      :project-selection="projectSelection"
      :reload="loadProjectSelection"
    />

    <v-sheet
      v-else
      class="project-selection-gate__picker"
      rounded="lg"
      border
    >
      <div class="project-selection-gate__header">
        <div>
          <p class="project-selection-gate__eyebrow">Project</p>
          <h2 class="project-selection-gate__title">Choose a project</h2>
          <p class="project-selection-gate__path">{{ projectsRoot }}</p>
        </div>
      </div>

      <div
        v-if="projects.length"
        class="project-selection-gate__list"
      >
        <v-btn
          v-for="project in projects"
          :key="project.path"
          class="project-selection-gate__project"
          :disabled="busy"
          :loading="selectingSlug === project.slug"
          variant="tonal"
          @click="selectProject(project.slug)"
        >
          <span>{{ project.slug }}</span>
          <span class="project-selection-gate__project-path">{{ project.path }}</span>
        </v-btn>
      </div>

      <v-form
        class="project-selection-gate__create"
        @submit.prevent="createProject"
      >
        <v-text-field
          v-model="newProjectName"
          autocomplete="off"
          density="comfortable"
          hide-details="auto"
          label="New project folder"
          :disabled="busy"
        />
        <v-btn
          color="primary"
          :disabled="!newProjectName.trim() || busy"
          :loading="creating"
          type="submit"
          variant="flat"
        >
          Create project
        </v-btn>
      </v-form>
    </v-sheet>
  </div>
</template>

<script setup>
import { computed, proxyRefs, ref, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";
import {
  VIBE64_SURFACE_ID,
  LOCAL_STUDIO_COMMAND_OPTIONS
} from "@/lib/vibe64RequestConfig.js";
import {
  PROJECT_SELECTION_ENDPOINT,
  VIBE64_PROJECT_CREATE_API_SUFFIX,
  VIBE64_PROJECT_SELECT_API_SUFFIX,
  projectSelectionQueryKey
} from "@/lib/studioGateApi.js";
import {
  studioHttpClient
} from "@/lib/studioHttp.js";

const emit = defineEmits(["missing", "ready", "error"]);

const creating = ref(false);
const selectingSlug = ref("");
const newProjectName = ref("");

const selectionResource = useEndpointResource({
  client: studioHttpClient,
  fallbackLoadError: "Projects could not load.",
  path: PROJECT_SELECTION_ENDPOINT,
  queryKey: computed(() => projectSelectionQueryKey(VIBE64_SURFACE_ID, ROUTE_VISIBILITY_PUBLIC)),
  refreshOnPull: true
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
    options: LOCAL_STUDIO_COMMAND_OPTIONS
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
    options: LOCAL_STUDIO_COMMAND_OPTIONS
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

const projectSelection = computed(() => projectSelectionView.record || {});
const projects = computed(() => Array.isArray(projectSelection.value.projects) ? projectSelection.value.projects : []);
const projectsRoot = computed(() => String(projectSelection.value.projectsRoot || "~/vibe64"));
const hasSelection = computed(() => projectSelection.value.hasSelection === true);
const busy = computed(() => creating.value || Boolean(selectingSlug.value));
const showLoadingBar = computed(() => projectSelectionView.isLoading && !projectSelectionView.record);
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
    await createProjectCommand.run({
      name
    });
    newProjectName.value = "";
  } finally {
    creating.value = false;
  }
}

async function selectProject(slug) {
  selectingSlug.value = String(slug || "");
  try {
    await selectProjectCommand.run({
      slug: selectingSlug.value
    });
  } finally {
    selectingSlug.value = "";
  }
}

watch(projectSelection, (selection) => {
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
</script>

<style scoped>
.project-selection-gate {
  display: grid;
  gap: 0.85rem;
  min-width: 0;
}

.project-selection-gate__picker {
  display: grid;
  gap: 1rem;
  margin-inline: auto;
  max-width: min(48rem, 100%);
  padding: 1rem;
  width: 100%;
}

.project-selection-gate__header {
  align-items: start;
  display: flex;
  justify-content: space-between;
  min-width: 0;
}

.project-selection-gate__eyebrow {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.76rem;
  font-weight: 680;
  letter-spacing: 0;
  margin: 0 0 0.15rem;
  text-transform: uppercase;
}

.project-selection-gate__title {
  font-size: 1.25rem;
  font-weight: 760;
  letter-spacing: 0;
  line-height: 1.15;
  margin: 0;
}

.project-selection-gate__path {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.82rem;
  margin: 0.35rem 0 0;
  overflow-wrap: anywhere;
}

.project-selection-gate__list {
  display: grid;
  gap: 0.45rem;
}

.project-selection-gate__project {
  justify-content: flex-start;
  min-height: 3.1rem;
  text-transform: none;
}

.project-selection-gate__project :deep(.v-btn__content) {
  align-items: flex-start;
  display: grid;
  gap: 0.1rem;
  justify-items: start;
  min-width: 0;
}

.project-selection-gate__project-path {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.75rem;
  max-width: min(38rem, 70vw);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-selection-gate__create {
  align-items: start;
  display: grid;
  gap: 0.65rem;
  grid-template-columns: minmax(0, 1fr) auto;
}

@media (max-width: 640px) {
  .project-selection-gate__create {
    grid-template-columns: 1fr;
  }
}
</style>
