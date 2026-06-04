<template>
  <div
    class="studio-ai-sessions__toolbar"
    :class="{ 'studio-ai-sessions__toolbar--compact': compact }"
  >
    <div class="studio-ai-sessions__tabs">
      <v-chip
        v-for="sessionItem in visibleSessions"
        :key="sessionItem.sessionId"
        class="studio-ai-sessions__tab"
        :class="{ 'studio-ai-sessions__tab--active': sessionItem.sessionId === selectedSessionId }"
        :size="compact ? 'small' : 'large'"
        variant="flat"
        @click="toolbar.selectSession(sessionItem.sessionId)"
      >
        <span
          class="studio-ai-sessions__status-dot"
          :class="`studio-ai-sessions__status-dot--${sessionItem.status}`"
        />
        <span>{{ sessionTabLabel(sessionItem) }}</span>
        <v-btn
          v-if="sessionItem.sessionId === selectedSessionId"
          class="studio-ai-sessions__tab-abandon"
          density="comfortable"
          :disabled="selectionClosed || abandon.command.isRunning"
          :icon="mdiClose"
          :loading="abandon.command.isRunning"
          size="small"
          title="Abandon session"
          variant="text"
          aria-label="Abandon session"
          @click.stop="abandon.request"
        />
      </v-chip>

      <v-btn
        v-if="createSessionVisible"
        aria-label="New session"
        class="studio-ai-sessions__create-button"
        :disabled="!toolbar.canCreateSession"
        :icon="mdiPlus"
        :loading="toolbar.createSessionCommand.isRunning"
        size="small"
        :title="toolbar.createSessionTitle"
        @click="openCreateSessionDialog"
        variant="flat"
      />

      <slot name="after-sessions" />
    </div>
  </div>

  <v-dialog
    v-model="createSessionDialogOpen"
    max-width="42rem"
  >
    <v-card class="studio-ai-sessions__create-dialog">
      <v-card-title>New session</v-card-title>
      <v-card-text class="studio-ai-sessions__create-dialog-body">
        <section class="studio-ai-sessions__create-section">
          <h2 class="studio-ai-sessions__create-section-title">Workflow</h2>
          <div class="studio-ai-sessions__choice-grid">
            <button
              v-for="definition in workflowOptions"
              :key="definition.id || 'default'"
              class="studio-ai-sessions__choice"
              :class="{ 'studio-ai-sessions__choice--active': selectedWorkflowDefinition === definition.id }"
              type="button"
              :aria-pressed="selectedWorkflowDefinition === definition.id"
              @click="selectedWorkflowDefinition = definition.id"
            >
              <strong>{{ definition.label }}</strong>
              <span v-if="definition.description">{{ definition.description }}</span>
            </button>
          </div>
        </section>

        <section class="studio-ai-sessions__create-section">
          <h2 class="studio-ai-sessions__create-section-title">AI runtime</h2>
          <div class="studio-ai-sessions__runtime-grid">
            <button
              v-for="runtime in runtimeOptions"
              :key="runtime.id"
              class="studio-ai-sessions__runtime-choice"
              :class="{ 'studio-ai-sessions__runtime-choice--active': selectedAgentRuntimeId === runtime.id }"
              type="button"
              :aria-pressed="selectedAgentRuntimeId === runtime.id"
              @click="selectedAgentRuntimeId = runtime.id"
            >
              {{ runtime.label }}
            </button>
          </div>
        </section>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          :disabled="toolbar.createSessionCommand.isRunning"
          @click="createSessionDialogOpen = false"
        >
          Cancel
        </v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :disabled="!selectedAgentRuntimeId || !toolbar.canCreateSession"
          :loading="toolbar.createSessionCommand.isRunning"
          @click="createSelectedSession"
        >
          Create
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { computed, ref } from "vue";
import {
  mdiClose,
  mdiPlus
} from "@mdi/js";

const props = defineProps({
  abandon: {
    default: () => ({}),
    type: Object
  },
  selectedSessionId: {
    default: "",
    type: String
  },
  selectionClosed: {
    default: false,
    type: Boolean
  },
  toolbar: {
    default: () => ({}),
    type: Object
  },
  compact: {
    default: false,
    type: Boolean
  },
  maxVisibleSessions: {
    default: 3,
    type: Number
  }
});

function sessionTabLabel(sessionItem = {}) {
  const sessionName = String(sessionItem.sessionName || sessionItem.metadata?.issue_word || "").trim();
  if (sessionName) {
    return sessionName;
  }
  return props.toolbar.shortSessionId?.(sessionItem.sessionId) || String(sessionItem.sessionId || "");
}

const workflowDefinitions = computed(() => {
  return Array.isArray(props.toolbar.workflowDefinitions) ? props.toolbar.workflowDefinitions : [];
});
const agentRuntimes = computed(() => {
  const runtimes = Array.isArray(props.toolbar.agentRuntimes) ? props.toolbar.agentRuntimes : [];
  return runtimes.length
    ? runtimes
    : [
        {
          default: true,
          id: "opencode",
          label: "OpenCode"
        }
      ];
});
const allSessions = computed(() => Array.isArray(props.toolbar.sessions) ? props.toolbar.sessions : []);
const sessionLimit = computed(() => Math.max(0, Number(props.maxVisibleSessions || 0)));
const sessionLimitReached = computed(() => Boolean(
  sessionLimit.value > 0 &&
  allSessions.value.length >= sessionLimit.value
));
const createSessionVisible = computed(() => !sessionLimitReached.value);
const visibleSessions = computed(() => {
  const limit = sessionLimit.value;
  if (limit < 1 || allSessions.value.length <= limit) {
    return allSessions.value;
  }
  const selectedIndex = allSessions.value.findIndex((sessionItem) => sessionItem.sessionId === props.selectedSessionId);
  if (selectedIndex < 0 || selectedIndex < limit) {
    return allSessions.value.slice(0, limit);
  }
  return [
    ...allSessions.value.slice(0, Math.max(0, limit - 1)),
    allSessions.value[selectedIndex]
  ];
});
const workflowOptions = computed(() => {
  const definitions = props.toolbar.createSessionMode === "select" && workflowDefinitions.value.length > 0
    ? workflowDefinitions.value
    : [
        {
          description: "",
          id: "",
          label: "New session"
        }
      ];
  return definitions.map((definition) => ({
    description: String(definition.description || ""),
    id: String(definition.id || ""),
    label: String(definition.label || "New session")
  }));
});
const runtimeOptions = computed(() => agentRuntimes.value.map((runtime) => ({
  default: runtime.default === true,
  id: String(runtime.id || ""),
  label: String(runtime.label || runtime.id || "AI runtime")
})).filter((runtime) => runtime.id));
const createSessionDialogOpen = ref(false);
const selectedWorkflowDefinition = ref("");
const selectedAgentRuntimeId = ref("");

function defaultRuntimeId() {
  return runtimeOptions.value.find((runtime) => runtime.default)?.id || runtimeOptions.value[0]?.id || "";
}

function ensureCreateSelections() {
  if (!workflowOptions.value.some((definition) => definition.id === selectedWorkflowDefinition.value)) {
    selectedWorkflowDefinition.value = workflowOptions.value[0]?.id || "";
  }
  if (!runtimeOptions.value.some((runtime) => runtime.id === selectedAgentRuntimeId.value)) {
    selectedAgentRuntimeId.value = defaultRuntimeId();
  }
}

function openCreateSessionDialog() {
  ensureCreateSelections();
  createSessionDialogOpen.value = true;
}

function createSelectedSession() {
  ensureCreateSelections();
  createSessionDialogOpen.value = false;
  props.toolbar.createSession?.(selectedWorkflowDefinition.value || "", {
    agentRuntimeId: selectedAgentRuntimeId.value || defaultRuntimeId()
  });
}
</script>

<style scoped>
.studio-ai-sessions__toolbar {
  align-items: center;
  display: flex;
  gap: 0.75rem;
  justify-content: flex-start;
  min-width: 0;
  width: 100%;
}

.studio-ai-sessions__tabs {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  min-width: 0;
  width: 100%;
}

.studio-ai-sessions__tab {
  align-items: center;
  background: var(--studio-control-rest-bg, #f7f7f8) !important;
  border: 1px solid transparent;
  border-radius: 999px;
  box-shadow: none !important;
  color: var(--studio-control-text, #202124) !important;
  font-weight: 500;
  max-width: 18rem;
}

.studio-ai-sessions__tab:hover {
  border-color: var(--studio-control-border, rgba(17, 24, 39, 0.12));
}

.studio-ai-sessions__tab--active {
  background: var(--studio-control-active-bg, #e7e7e7) !important;
  border-color: transparent;
  color: var(--studio-control-text, #202124) !important;
  font-weight: 560;
}

.studio-ai-sessions__tab :deep(.v-chip__overlay),
.studio-ai-sessions__tab :deep(.v-chip__underlay) {
  display: none;
}

.studio-ai-sessions__tab-abandon {
  color: var(--studio-control-muted-text, #5f6368) !important;
  margin-left: 0.3rem;
  min-height: 1.75rem;
  min-width: 1.75rem;
}

.studio-ai-sessions__tab-abandon:hover,
.studio-ai-sessions__tab-abandon:focus-visible {
  background: rgba(17, 24, 39, 0.08) !important;
  color: var(--studio-control-text, #202124) !important;
}

.studio-ai-sessions__tab-abandon :deep(.v-icon) {
  font-size: 1.15rem;
}

.studio-ai-sessions__create-button {
  background: var(--studio-control-rest-bg, #f7f7f8) !important;
  border: 1px solid transparent;
  border-radius: 999px;
  box-shadow: none !important;
  color: #1a73e8 !important;
  height: 3rem;
  min-height: 3rem;
  min-width: 3rem;
}

.studio-ai-sessions__create-button:hover {
  background: var(--studio-control-active-bg, #e7e7e7) !important;
}

.studio-ai-sessions__status-dot {
  background: rgb(var(--v-theme-primary));
  border-radius: 999px;
  display: inline-block;
  height: 0.52rem;
  margin-right: 0.42rem;
  width: 0.52rem;
}

.studio-ai-sessions__create-dialog-body {
  display: grid;
  gap: 1rem;
}

.studio-ai-sessions__create-section {
  display: grid;
  gap: 0.5rem;
}

.studio-ai-sessions__create-section-title {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.82rem;
  font-weight: 700;
  letter-spacing: 0;
  line-height: 1.2;
  margin: 0;
  text-transform: uppercase;
}

.studio-ai-sessions__choice-grid {
  display: grid;
  gap: 0.5rem;
}

.studio-ai-sessions__choice,
.studio-ai-sessions__runtime-choice {
  appearance: none;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.16);
  border-radius: 8px;
  color: rgb(var(--v-theme-on-surface));
  cursor: pointer;
  font: inherit;
  letter-spacing: 0;
  text-align: left;
}

.studio-ai-sessions__choice {
  display: grid;
  gap: 0.2rem;
  line-height: 1.25;
  padding: 0.75rem 0.85rem;
}

.studio-ai-sessions__choice span {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.88rem;
  line-height: 1.35;
}

.studio-ai-sessions__runtime-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.studio-ai-sessions__runtime-choice {
  min-height: 2.5rem;
  min-width: 7rem;
  padding: 0.55rem 0.85rem;
  text-align: center;
}

.studio-ai-sessions__choice:hover,
.studio-ai-sessions__runtime-choice:hover {
  border-color: rgba(var(--v-theme-primary), 0.45);
}

.studio-ai-sessions__choice--active,
.studio-ai-sessions__runtime-choice--active {
  background: rgba(var(--v-theme-primary), 0.08);
  border-color: rgb(var(--v-theme-primary));
}

.studio-ai-sessions__status-dot--abandoned,
.studio-ai-sessions__status-dot--failed {
  background: rgb(var(--v-theme-error));
}

.studio-ai-sessions__status-dot--finished {
  background: rgb(var(--v-theme-success));
}

.studio-ai-sessions__toolbar--compact .studio-ai-sessions__tabs {
  flex-wrap: nowrap;
  gap: 0.34rem;
}

.studio-ai-sessions__toolbar--compact {
  height: 2rem;
  min-height: 2rem;
}

.studio-ai-sessions__toolbar--compact .studio-ai-sessions__tab {
  font-size: 0.92rem;
  height: 2rem;
  letter-spacing: 0;
  max-width: 12.5rem;
  min-height: 2rem;
  padding-inline: 0.72rem;
}

.studio-ai-sessions__toolbar--compact .studio-ai-sessions__status-dot {
  height: 0.58rem;
  margin-right: 0.42rem;
  width: 0.58rem;
}

.studio-ai-sessions__toolbar--compact .studio-ai-sessions__tab-abandon {
  margin-left: 0.34rem;
  min-height: 1.82rem;
  min-width: 1.82rem;
}

.studio-ai-sessions__toolbar--compact .studio-ai-sessions__tab-abandon :deep(.v-icon) {
  font-size: 1.15rem;
}

.studio-ai-sessions__toolbar--compact .studio-ai-sessions__create-button {
  height: 2rem;
  min-height: 2rem;
  min-width: 2rem;
  width: 2rem;
}

@media (max-width: 640px) {
  .studio-ai-sessions__toolbar {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
