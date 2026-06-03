<template>
  <v-sheet
    rounded="lg"
    class="studio-ai-sessions studio-ai-sessions--autopilot studio-screen__panel"
    :class="{ 'studio-ai-sessions--with-header': panelHeaderVisible }"
  >
    <div
      v-if="panelHeaderVisible"
      class="studio-ai-sessions__header"
    >
      <StudioErrorNotice
        v-if="pageError"
        title="Vibe64 sessions could not load"
        :error="pageError"
        compact
      />

      <Vibe64SessionToolbar
        v-if="panelSessionToolbarVisible"
        :abandon="selectedAbandon"
        :selected-session-id="selection.selectedSessionId"
        :selection-closed="selection.isClosed"
        :toolbar="toolbar"
      />
    </div>

    <div
      v-if="!selection.selectedSession"
      class="studio-ai-sessions__empty-layout"
      :class="{
        'studio-ai-sessions__empty-layout--dashboard': dashboardWorkspaceActive
      }"
    >
      <div class="studio-ai-sessions__empty-main">
        <v-sheet
          v-if="emptyStateVisible"
          rounded="lg"
          border
          class="studio-ai-sessions__empty"
        >
          <p class="text-body-2 text-medium-emphasis mb-0">{{ emptyStateText }}</p>
        </v-sheet>
      </div>

      <div
        v-if="dashboardWorkspaceActive"
        class="studio-ai-sessions__dashboard-empty-pane"
      >
        <slot name="dashboard" :dashboard-context="emptyDashboardContext" />
      </div>
    </div>

    <div v-else class="studio-ai-sessions__runtime-stack">
      <Vibe64SessionRuntimeHost
        :key="selection.selectedSessionId"
        active
        :session-data="sessionData"
        :session-id="selection.selectedSessionId"
        session-mode="autopilot"
        :chat-collapsed="chatCollapsed"
        :workspace-pane="workspacePane"
        @busy-change="setRuntimeBusy"
        @page-error-change="setRuntimePageError"
        @toolbar-controls-ready="setRuntimeToolbarControls"
      >
        <template #dashboard="dashboardSlotProps">
          <slot
            name="dashboard"
            :dashboard-context="dashboardSlotProps?.dashboardContext || {}"
          />
        </template>
      </Vibe64SessionRuntimeHost>
    </div>
  </v-sheet>
</template>

<script setup>
import { computed, proxyRefs, reactive, watch } from "vue";
import { useRoute } from "vue-router";
import Vibe64SessionRuntimeHost from "@/components/studio/vibe64-session/Vibe64SessionRuntimeHost.vue";
import Vibe64SessionToolbar from "@/components/studio/vibe64-session/Vibe64SessionToolbar.vue";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";
import {
  blockingVibe64SessionPageError
} from "@/lib/vibe64SessionPanelModel.js";
import {
  useVibe64SessionData
} from "@/composables/useVibe64SessionData.js";

const emit = defineEmits(["title-change"]);
const props = defineProps({
  chatCollapsed: {
    default: false,
    type: Boolean
  },
  workspacePane: {
    default: "",
    type: String
  }
});
const route = useRoute();

const fallbackAbandon = {
  command: {
    isRunning: false
  },
  request: () => null
};
const runtimeStateBySessionId = reactive({});
const sessionData = useVibe64SessionData({
  onTitleChange(title) {
    emit("title-change", title);
  }
});

const selection = proxyRefs({
  isClosed: sessionData.isSelectedSessionClosed,
  selectedSession: sessionData.selectedSession,
  selectedSessionId: sessionData.selectedSessionId
});
const toolbar = proxyRefs({
  canCreateSession: sessionData.canCreateSession,
  createSession: sessionData.createSession,
  createSessionCommand: sessionData.createSessionCommand,
  createSessionMode: sessionData.createSessionMode,
  createSessionTitle: sessionData.createSessionTitle,
  selectSession: sessionData.selectSessionId,
  sessions: sessionData.sessions,
  shortSessionId: sessionData.shortSessionId,
  workflowDefinitions: sessionData.workflowDefinitions
});

const workspacePane = computed(() => normalizeWorkspacePane(props.workspacePane || route.query.pane));
const pageLoading = sessionData.pageLoading;
const chatCollapsed = computed(() => Boolean(props.chatCollapsed));
const panelSessionToolbarVisible = computed(() => Boolean(
  !selection.selectedSession
));
const dashboardWorkspaceActive = computed(() => workspacePane.value === "dashboard");
const emptyDashboardContext = Object.freeze({});
const emptyStateVisible = computed(() => Boolean(!pageLoading.value || (toolbar.sessions || []).length > 0));
const emptyStateText = computed(() => {
  return toolbar.sessions?.length > 0 ? "Selecting session..." : "No sessions yet.";
});
const selectedRuntimeState = computed(() => runtimeStateBySessionId[selection.selectedSessionId] || null);
const selectedAbandon = computed(() => selectedRuntimeState.value?.toolbarControls?.abandon || fallbackAbandon);
const pageError = computed(() => blockingVibe64SessionPageError({
  runtimePageError: selectedRuntimeState.value?.pageError,
  selectedSession: selection.selectedSession,
  selectedSessionLoadError: sessionData.selectedSessionView?.loadError,
  sessionListLoadError: sessionData.sessionList.loadError,
  sessions: toolbar.sessions || []
}));
const panelHeaderVisible = computed(() => Boolean(pageError.value || panelSessionToolbarVisible.value));

function ensureRuntimeState(sessionId = "") {
  const key = String(sessionId || "");
  if (!key) {
    return null;
  }
  if (!runtimeStateBySessionId[key]) {
    runtimeStateBySessionId[key] = {
      toolbarControls: null,
      busy: false,
      pageError: ""
    };
  }
  return runtimeStateBySessionId[key];
}

function setRuntimeToolbarControls({
  controls = null,
  sessionId = ""
} = {}) {
  const state = ensureRuntimeState(sessionId);
  if (state) {
    state.toolbarControls = controls;
  }
}

function setRuntimeBusy({
  busy = false,
  sessionId = ""
} = {}) {
  const state = ensureRuntimeState(sessionId);
  if (state) {
    state.busy = Boolean(busy);
  }
}

function setRuntimePageError({
  error = "",
  sessionId = ""
} = {}) {
  const state = ensureRuntimeState(sessionId);
  if (state) {
    state.pageError = String(error || "");
  }
}

function normalizeWorkspacePane(value = "") {
  return ["configure", "dashboard", "history", "preview", "run", "setup"].includes(value)
    ? value
    : "preview";
}

watch(sessionData.sessions, (sessions = []) => {
  const visibleSessionIds = new Set(sessions.map((session) => session.sessionId));
  for (const sessionId of Object.keys(runtimeStateBySessionId)) {
    if (!visibleSessionIds.has(sessionId)) {
      delete runtimeStateBySessionId[sessionId];
    }
  }
});
</script>

<style scoped>
.studio-ai-sessions {
  display: grid;
  gap: 0.85rem;
  min-height: 0;
}

.studio-ai-sessions--autopilot {
  background: transparent;
  border-radius: 0 !important;
  box-shadow: none;
  gap: 0;
  grid-template-rows: minmax(0, 1fr);
  padding: 0;
}

.studio-ai-sessions--autopilot.studio-ai-sessions--with-header {
  grid-template-rows: auto minmax(0, 1fr);
}

.studio-ai-sessions__empty {
  padding: 0.9rem;
}

.studio-ai-sessions__empty-main {
  align-self: start;
  min-width: 0;
}

.studio-ai-sessions__empty-layout {
  --studio-ai-sessions-codex-terminal-column: minmax(30rem, 1.22fr);
  --studio-ai-sessions-main-column: minmax(18rem, 0.78fr);
  --studio-ai-sessions-layout-gap: 0.9rem;
  display: grid;
  gap: var(--studio-ai-sessions-layout-gap);
  min-height: 0;
}

.studio-ai-sessions__dashboard-empty-pane {
  min-height: 0;
  min-width: 0;
}

.studio-ai-sessions__header {
  display: grid;
  gap: 0.65rem;
}

.studio-ai-sessions__runtime-stack {
  display: grid;
  min-height: 0;
}

.studio-ai-sessions--autopilot .studio-ai-sessions__runtime-stack {
  height: 100%;
}

@media (min-width: 981px) {
  .studio-ai-sessions {
    grid-template-rows: auto minmax(0, 1fr);
    height: 100%;
    overflow: hidden;
  }

  .studio-ai-sessions--autopilot {
    grid-template-rows: minmax(0, 1fr);
  }

  .studio-ai-sessions--autopilot.studio-ai-sessions--with-header {
    grid-template-rows: auto minmax(0, 1fr);
  }

  .studio-ai-sessions__runtime-stack {
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }

  .studio-ai-sessions__empty-layout--dashboard {
    align-items: stretch;
    grid-template-columns: var(--studio-ai-sessions-main-column) var(--studio-ai-sessions-codex-terminal-column);
    height: 100%;
    overflow: hidden;
  }
}
</style>
