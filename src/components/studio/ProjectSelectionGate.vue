<template>
  <div class="project-selection-gate">
    <StudioErrorNotice
      v-if="errorMessage"
      title="Projects could not load"
      :error="errorMessage"
      compact
    />

    <slot
      v-if="selectedSlotVisible"
      :project-selection="projectSelection"
      :reload="loadProjectSelection"
    />

    <v-sheet
      v-else-if="pickerVisible"
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
          @click="handleSelectProject(project.slug)"
        >
          <span>{{ project.slug }}</span>
          <span class="project-selection-gate__project-path">{{ project.path }}</span>
        </v-btn>
      </div>

      <v-form
        class="project-selection-gate__create"
        @submit.prevent="handleCreateProject"
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
import { computed } from "vue";
import { useRouter } from "vue-router";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";
import { useProjectSelectionGate } from "@/composables/useProjectSelectionGate.js";
import {
  projectAppPath
} from "@/lib/vibe64ProjectScope.js";

const props = defineProps({
  forcePicker: {
    type: Boolean,
    default: false
  },
  navigateOnSelect: {
    type: Boolean,
    default: false
  },
  scopeSelectionToCurrentProject: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(["missing", "ready", "error"]);
const router = useRouter();

const {
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
} = useProjectSelectionGate(emit, {
  scopeSelectionToCurrentProject: props.scopeSelectionToCurrentProject
});

const selectedSlotVisible = computed(() => hasSelection.value && !props.forcePicker);
const pickerVisible = computed(() => selectionReady.value && (props.forcePicker || !hasSelection.value));

async function handleSelectProject(slug = "") {
  const selected = await selectProject(slug);
  if (props.navigateOnSelect && selected) {
    void router.push(projectAppPath(selected));
  }
}

async function handleCreateProject() {
  const selected = await createProject();
  if (props.navigateOnSelect && selected) {
    void router.push(projectAppPath(selected));
  }
}
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
