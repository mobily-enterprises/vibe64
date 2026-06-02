<template>
  <div
    class="studio-ai-sessions__toolbar"
    :class="{ 'studio-ai-sessions__toolbar--compact': compact }"
  >
    <div class="studio-ai-sessions__tabs">
      <v-chip
        v-for="sessionItem in visibleSessions"
        :key="sessionItem.sessionId"
        :color="sessionItem.sessionId === selectedSessionId ? 'primary' : 'default'"
        :variant="sessionItem.sessionId === selectedSessionId ? 'flat' : 'tonal'"
        class="studio-ai-sessions__tab"
        :size="compact ? 'small' : 'large'"
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

      <v-menu
        v-if="showWorkflowDefinitionMenu"
        v-model="workflowDefinitionMenuOpen"
        location="bottom end"
        transition="scale-transition"
      >
        <template #activator="{ props: menuProps }">
          <v-btn
            v-bind="menuProps"
            aria-label="New session"
            class="studio-ai-sessions__create-button"
            color="primary"
            :disabled="!toolbar.canCreateSession"
            :icon="mdiPlus"
            :loading="toolbar.createSessionCommand.isRunning"
            size="small"
            :title="toolbar.createSessionTitle"
            variant="tonal"
          />
        </template>

        <v-list
          class="studio-ai-sessions__definition-menu"
          density="comfortable"
          lines="two"
          nav
        >
          <v-list-subheader>Session type</v-list-subheader>
          <v-list-item
            v-for="definition in workflowDefinitions"
            :key="definition.id"
            :disabled="toolbar.createSessionCommand.isRunning"
            :subtitle="definition.description"
            :title="definition.label"
            @click="createSessionFromDefinition(definition.id)"
          />
        </v-list>
      </v-menu>

      <v-btn
        v-else-if="createSessionVisible"
        aria-label="New session"
        class="studio-ai-sessions__create-button"
        color="primary"
        :disabled="!toolbar.canCreateSession"
        :icon="mdiPlus"
        :loading="toolbar.createSessionCommand.isRunning"
        size="small"
        :title="toolbar.createSessionTitle"
        @click="toolbar.createSession()"
        variant="tonal"
      />
    </div>
  </div>
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
const showWorkflowDefinitionMenu = computed(() => {
  return createSessionVisible.value && props.toolbar.createSessionMode === "select" && workflowDefinitions.value.length > 0;
});
const workflowDefinitionMenuOpen = ref(false);

function createSessionFromDefinition(definitionId = "") {
  workflowDefinitionMenuOpen.value = false;
  props.toolbar.createSession?.(definitionId);
}
</script>

<style scoped>
.studio-ai-sessions__toolbar {
  align-items: center;
  display: flex;
  gap: 0.75rem;
  justify-content: flex-start;
  min-width: 0;
}

.studio-ai-sessions__tabs {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  min-width: 0;
}

.studio-ai-sessions__tab {
  align-items: center;
  max-width: 18rem;
}

.studio-ai-sessions__tab-abandon {
  margin-left: 0.3rem;
  min-height: 1.75rem;
  min-width: 1.75rem;
}

.studio-ai-sessions__tab-abandon:hover,
.studio-ai-sessions__tab-abandon:focus-visible {
  background: rgba(var(--v-theme-on-primary), 0.16);
}

.studio-ai-sessions__tab-abandon :deep(.v-icon) {
  font-size: 1.15rem;
}

.studio-ai-sessions__create-button {
  border-radius: 999px;
  height: 3rem;
  min-height: 3rem;
  min-width: 3rem;
}

.studio-ai-sessions__definition-menu {
  max-width: min(28rem, calc(100vw - 2rem));
  min-width: min(22rem, calc(100vw - 2rem));
}

.studio-ai-sessions__definition-menu :deep(.v-list-item-subtitle) {
  white-space: normal;
}

.studio-ai-sessions__status-dot {
  background: rgb(var(--v-theme-primary));
  border-radius: 999px;
  display: inline-block;
  height: 0.52rem;
  margin-right: 0.42rem;
  width: 0.52rem;
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
  gap: 0.42rem;
}

.studio-ai-sessions__toolbar--compact {
  height: 1.5rem;
  min-height: 1.5rem;
  transform: translateY(-0.35rem);
}

.studio-ai-sessions__toolbar--compact .studio-ai-sessions__tab {
  font-size: 1rem;
  height: 2.25rem;
  letter-spacing: 0;
  max-width: 13.5rem;
  min-height: 2.25rem;
  padding-inline: 0.85rem;
}

.studio-ai-sessions__toolbar--compact .studio-ai-sessions__status-dot {
  height: 0.68rem;
  margin-right: 0.5rem;
  width: 0.68rem;
}

.studio-ai-sessions__toolbar--compact .studio-ai-sessions__tab-abandon {
  margin-left: 0.42rem;
  min-height: 2.05rem;
  min-width: 2.05rem;
}

.studio-ai-sessions__toolbar--compact .studio-ai-sessions__tab-abandon :deep(.v-icon) {
  font-size: 1.3rem;
}

.studio-ai-sessions__toolbar--compact .studio-ai-sessions__create-button {
  height: 2.25rem;
  min-height: 2.25rem;
  min-width: 2.25rem;
  width: 2.25rem;
}

@media (max-width: 640px) {
  .studio-ai-sessions__toolbar {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
