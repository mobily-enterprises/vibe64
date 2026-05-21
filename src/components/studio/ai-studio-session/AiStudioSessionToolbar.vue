<template>
  <div class="studio-ai-sessions__toolbar">
    <div class="studio-ai-sessions__tabs">
      <v-chip
        v-for="sessionItem in toolbar.sessions"
        :key="sessionItem.sessionId"
        :color="sessionItem.sessionId === selectedSessionId ? 'primary' : 'default'"
        :variant="sessionItem.sessionId === selectedSessionId ? 'flat' : 'tonal'"
        class="studio-ai-sessions__tab"
        size="large"
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
        v-if="showWorkflowProfileMenu"
        location="bottom end"
        transition="scale-transition"
      >
        <template #activator="{ props: menuProps }">
          <v-btn
            v-bind="menuProps"
            color="primary"
            variant="tonal"
            :append-icon="mdiChevronDown"
            :disabled="!toolbar.canCreateSession"
            :loading="toolbar.createSessionCommand.isRunning"
            :prepend-icon="mdiPlus"
            :title="toolbar.createSessionTitle"
          >
            New Session
          </v-btn>
        </template>

        <v-list
          class="studio-ai-sessions__profile-menu"
          density="comfortable"
          lines="two"
          nav
        >
          <v-list-subheader>Session type</v-list-subheader>
          <v-list-item
            v-for="profile in workflowProfiles"
            :key="profile.id"
            :disabled="toolbar.createSessionCommand.isRunning"
            :subtitle="profile.description"
            :title="profile.label"
            @click="toolbar.createSession(profile.id)"
          />
        </v-list>
      </v-menu>

      <v-btn
        v-else
        color="primary"
        variant="tonal"
        :disabled="!toolbar.canCreateSession"
        :loading="toolbar.createSessionCommand.isRunning"
        :prepend-icon="mdiPlus"
        :title="toolbar.createSessionTitle"
        @click="toolbar.createSession()"
      >
        New Session
      </v-btn>
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";
import {
  mdiChevronDown,
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
  }
});

function sessionTabLabel(sessionItem = {}) {
  const sessionName = String(sessionItem.sessionName || sessionItem.metadata?.issue_word || "").trim();
  if (sessionName) {
    return sessionName;
  }
  return props.toolbar.shortSessionId?.(sessionItem.sessionId) || String(sessionItem.sessionId || "");
}

const workflowProfiles = computed(() => {
  return Array.isArray(props.toolbar.workflowProfiles) ? props.toolbar.workflowProfiles : [];
});
const showWorkflowProfileMenu = computed(() => {
  return props.toolbar.createSessionMode === "select" && workflowProfiles.value.length > 0;
});
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

.studio-ai-sessions__profile-menu {
  max-width: min(28rem, calc(100vw - 2rem));
  min-width: min(22rem, calc(100vw - 2rem));
}

.studio-ai-sessions__profile-menu :deep(.v-list-item-subtitle) {
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

@media (max-width: 640px) {
  .studio-ai-sessions__toolbar {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
