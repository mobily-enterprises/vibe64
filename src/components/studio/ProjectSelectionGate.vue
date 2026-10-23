<template>
  <div class="project-selection-gate">
    <v-sheet
      v-if="practiceDeleted"
      class="project-selection-gate__deleted"
      rounded="lg"
      border
      role="status"
    >
      <h2 class="project-selection-gate__title">This practice project is gone</h2>
      <p class="project-selection-gate__deleted-text">It was archived or deleted. Its lesson is under Courses → Archived; start it again from Courses.</p>
      <v-btn
        v-if="learning"
        class="project-selection-gate__deleted-learning"
        color="primary"
        variant="flat"
        min-height="48"
        @click="openCourses"
      >
        Open Courses
      </v-btn>
    </v-sheet>

    <v-sheet
      v-else-if="learningModeBlocked"
      class="project-selection-gate__deleted"
      rounded="lg"
      border
      role="status"
      data-test="learning-mode-project-note"
    >
      <p class="project-selection-gate__deleted-text">{{ learningModeMessage }}</p>
      <v-btn
        color="primary"
        variant="flat"
        min-height="48"
        data-test="learning-mode-project-switch"
        @click="toggleMode"
      >
        {{ learnMode ? "Switch to Develop" : "Switch to Learn" }}
      </v-btn>
    </v-sheet>

    <Vibe64TeamAiGate
      v-else-if="teamAiBlocked"
      :checking="recovering"
      :owner-name="teamAiOwnerName"
      :projects-path="projectsPath"
      @check="retryProject"
    />

    <StudioErrorNotice
      v-else-if="displayError"
      title="Project could not load"
      :error="displayError"
      compact
    >
      <template #actions>
        <v-btn
          color="primary"
          variant="flat"
          min-height="48"
          :disabled="recovering"
          @click="retryProject"
        >
          {{ recovering ? "Checking project…" : "Try again" }}
        </v-btn>
      </template>
    </StudioErrorNotice>

    <v-skeleton-loader
      v-if="!teamAiBlocked && !displayError && (selectionInitialLoading || !runtimeReady)"
      aria-label="Loading project"
      class="project-selection-gate__loading"
      type="article"
    />

    <slot
      v-else-if="runtimeReady && selectedSlotVisible"
      :project-selection="projectSelection"
      :reload="loadProjectSelection"
    />

    <v-sheet
      v-else-if="runtimeReady && pickerVisible"
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
        v-if="learnMode"
        class="project-selection-gate__learning-note"
        role="status"
        data-test="learning-mode-picker-note"
      >
        <span>{{ learningModeNote }}</span>
        <v-btn
          variant="tonal"
          min-height="40"
          data-test="learning-mode-picker-switch"
          @click="toggleMode"
        >
          Switch to Develop
        </v-btn>
      </div>

      <div
        v-if="teamAiOwnerPrompt"
        class="project-selection-gate__team-ai"
        role="status"
        data-test="team-ai-owner-prompt"
      >
        <div class="project-selection-gate__team-ai-text">
          <strong>Team members can't open projects yet</strong>
          <span>Set up AI for team members so they can work here.</span>
        </div>
        <v-btn
          color="primary"
          variant="flat"
          min-height="48"
          data-test="team-ai-owner-setup"
          @click="openTeamAiSetup"
        >
          Set up team AI
        </v-btn>
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
          <span class="project-selection-gate__project-name">
            {{ project.slug }}
            <v-chip
              v-if="project.approvalsWaiting > 0"
              color="warning"
              size="small"
              variant="tonal"
              data-test="project-approvals-waiting"
            >
              {{ project.approvalsWaiting }} waiting
            </v-chip>
          </span>
          <span class="project-selection-gate__project-path">{{ project.path }}</span>
        </v-btn>
      </div>

      <v-form
        v-if="!learnMode"
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
import { computed, onBeforeUnmount, ref } from "vue";
import { useRouter } from "vue-router";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";
import Vibe64TeamAiGate from "@/components/studio/Vibe64TeamAiGate.vue";
import { requestVibe64AccountConnectionsDialog } from "@/lib/vibe64AccountConnectionsDialog.js";
import { useProjectSelectionGate } from "@/composables/useProjectSelectionGate.js";
import { useVibe64Learning } from "@/composables/useVibe64Learning.js";
import { VIBE64_LEARNING_MODE_NOTE } from "@/lib/vibe64Learning.js";
import {
  projectAppPath
} from "@/lib/vibe64ProjectScope.js";

const props = defineProps({
  beforeRetry: {
    type: Function,
    default: null
  },
  runtimeReady: {
    type: Boolean,
    default: true
  },
  runtimeError: {
    type: String,
    default: ""
  },
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

const PROJECTS_PATH = "/app/manage/projects";
const emit = defineEmits(["missing", "ready", "error", "deleted", "retry-runtime"]);
const router = useRouter();
// Learn/Develop and Courses, where the deleted practice project's lesson remains (null without a host shell).
const learning = useVibe64Learning();
const recovering = ref(false);
const recoveryError = ref("");
let disposed = false;
onBeforeUnmount(() => {
  disposed = true;
});

const {
  busy,
  createProject,
  creating,
  errorMessage,
  hasSelection,
  learnMode,
  learningModeBlocked,
  learningModeMessage,
  toggleMode,
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
} = useProjectSelectionGate(emit, {
  scopeSelectionToCurrentProject: props.scopeSelectionToCurrentProject
});

const learningModeNote = VIBE64_LEARNING_MODE_NOTE;
const displayError = computed(() => recoveryError.value || errorMessage.value || props.runtimeError);
const selectedSlotVisible = computed(() => hasSelection.value && !props.forcePicker && !practiceDeleted.value && !teamAiBlocked.value);
const pickerVisible = computed(() => !practiceDeleted.value && !learningModeBlocked.value && !teamAiBlocked.value &&
  selectionReady.value && (props.forcePicker || !hasSelection.value));
// The host's project list, where it has one.
const projectsPath = router.resolve(PROJECTS_PATH).matched.length ? PROJECTS_PATH : "";

function openTeamAiSetup() {
  requestVibe64AccountConnectionsDialog({ providerId: "ai", section: "team" });
}

function openCourses() {
  return learning?.openCourses();
}

async function retryProject() {
  if (recovering.value) {
    return;
  }
  recovering.value = true;
  recoveryError.value = "";
  try {
    await props.beforeRetry?.();
    if (disposed) {
      return;
    }
    await loadProjectSelection();
    if (!disposed && !errorMessage.value && !teamAiBlocked.value && !props.runtimeReady) {
      emit("retry-runtime");
    }
  } catch (error) {
    recoveryError.value = String(error?.message || "Project could not load. Try again.");
  } finally {
    recovering.value = false;
  }
}

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
  align-content: start;
  display: grid;
  gap: 0.85rem;
  min-width: 0;
}

.project-selection-gate__deleted {
  display: grid;
  gap: 0.75rem;
  justify-items: start;
  margin-inline: auto;
  max-width: min(36rem, 100%);
  padding: 1.25rem;
  width: 100%;
}

.project-selection-gate__learning-note {
  align-items: center;
  background: var(--v64-learning-container, rgba(245, 197, 24, 0.24));
  border-radius: 0.5rem;
  color: var(--v64-on-learning-container, inherit);
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 0.75rem;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
}

.project-selection-gate__team-ai {
  align-items: center;
  background: rgb(var(--v-theme-warning-container));
  border: 1px solid rgba(var(--v-theme-warning), 0.35);
  border-radius: 0.5rem;
  color: rgb(var(--v-theme-on-warning-container));
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  justify-content: space-between;
  padding: 0.75rem 1rem;
}

.project-selection-gate__team-ai-text {
  display: grid;
  gap: 0.15rem;
  min-width: min(100%, 16rem);
}

.project-selection-gate__team-ai-text span {
  opacity: 0.8;
}

.project-selection-gate__project-name {
  align-items: center;
  display: inline-flex;
  gap: 0.5rem;
}

.project-selection-gate__deleted-text {
  color: rgba(var(--v-theme-on-surface), 0.72);
  margin: 0;
}

.project-selection-gate__loading {
  flex: 1 1 auto;
  min-height: 18rem;
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

  .project-selection-gate__team-ai .v-btn {
    width: 100%;
  }
}
</style>
