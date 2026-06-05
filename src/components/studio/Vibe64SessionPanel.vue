<template>
  <v-sheet
    rounded="lg"
    class="studio-ai-sessions studio-ai-sessions--autopilot studio-screen__panel"
    :class="{ 'studio-ai-sessions--with-header': panelHeaderVisible }"
  >
    <Transition name="studio-ai-sessions-error">
      <div
        v-if="visiblePageError"
        class="studio-ai-sessions__error-overlay"
      >
        <StudioErrorNotice
          title="Vibe64 sessions could not load"
          :error="pageError"
          compact
          dismissible
          @dismiss="dismissPageError"
        />
      </div>
    </Transition>

    <div
      v-if="panelHeaderVisible"
      class="studio-ai-sessions__header"
    >
      <Vibe64SessionToolbar
        v-if="panelSessionToolbarVisible"
        :abandon="selectedAbandon"
        :selected-session-id="selection.selectedSessionId"
        :selection-closed="selection.isClosed"
        :toolbar="toolbar"
      />
    </div>

    <div
      v-if="emptyLayoutVisible"
      class="studio-ai-sessions__empty-layout"
      :class="{
        'studio-ai-sessions__empty-layout--dashboard': dashboardWorkspaceActive
      }"
    >
      <div class="studio-ai-sessions__empty-main">
        <div
          v-if="emptyStateVisible"
          class="studio-ai-sessions__empty"
        >
          <Vibe64CreateSessionButton
            aria-label="Start session"
            button-class="studio-ai-sessions__empty-create"
            :block="false"
            :icon-only="false"
            label="Start session"
            menu-location="bottom center"
            size="large"
            :toolbar="toolbar"
          />
          <p
            v-if="emptyCreateReasonVisible"
            class="studio-ai-sessions__empty-reason text-body-2 text-medium-emphasis"
          >
            {{ toolbar.createSessionTitle }}
          </p>
        </div>
      </div>

      <div
        v-if="dashboardWorkspaceActive"
        class="studio-ai-sessions__dashboard-empty-pane"
      >
        <slot name="dashboard" :dashboard-context="emptyDashboardContext" />
      </div>
    </div>

    <div
      v-show="runtimeHostSessionIds.length > 0"
      class="studio-ai-sessions__runtime-stack"
    >
      <Vibe64SessionRuntimeHost
        v-for="runtimeSessionId in runtimeHostSessionIds"
        v-show="runtimeSessionId === selection.selectedSessionId"
        :key="runtimeSessionId"
        :active="runtimeSessionId === selection.selectedSessionId"
        :session-data="sessionData"
        :session-id="runtimeSessionId"
        :chat-collapsed="chatCollapsed"
        :workspace-pane="workspacePane"
        @busy-change="setRuntimeBusy"
        @page-error-change="setRuntimePageError"
        @toolbar-controls-ready="setRuntimeToolbarControls"
        @workspace-attention="emitWorkspaceAttention"
        @workspace-pane-change="emitWorkspacePaneChange"
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
import { computed, proxyRefs, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import Vibe64SessionRuntimeHost from "@/components/studio/vibe64-session/Vibe64SessionRuntimeHost.vue";
import Vibe64SessionToolbar from "@/components/studio/vibe64-session/Vibe64SessionToolbar.vue";
import Vibe64CreateSessionButton from "@/components/studio/vibe64-session/Vibe64CreateSessionButton.vue";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";
import {
  blockingVibe64SessionPageError
} from "@/lib/vibe64SessionPanelModel.js";
import {
  useVibe64SessionData
} from "@/composables/useVibe64SessionData.js";

const emit = defineEmits(["title-change", "workspace-attention", "workspace-pane-change"]);
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
const dismissedPageError = ref("");
const mountedRuntimeSessionIds = ref([]);
const runtimeStateBySessionId = reactive({});
const sessionData = useVibe64SessionData({
  onTitleChange(title) {
    emit("title-change", title);
  }
});

function emitWorkspacePaneChange(pane = "") {
  emit("workspace-pane-change", pane);
}

function emitWorkspaceAttention() {
  emit("workspace-attention");
}

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
const emptyCreateReasonVisible = computed(() => Boolean(!toolbar.canCreateSession && toolbar.createSessionTitle));
const selectedRuntimeState = computed(() => runtimeStateBySessionId[selection.selectedSessionId] || null);
const runtimeHostSessionIds = computed(() => {
  const visibleSessionIds = new Set((toolbar.sessions || []).map((session) => session.sessionId));
  if (selection.selectedSession && selection.selectedSessionId) {
    visibleSessionIds.add(selection.selectedSessionId);
  }
  return mountedRuntimeSessionIds.value.filter((sessionId) => visibleSessionIds.has(sessionId));
});
const emptyLayoutVisible = computed(() => Boolean(!selection.selectedSession && runtimeHostSessionIds.value.length < 1));
const selectedAbandon = computed(() => selectedRuntimeState.value?.toolbarControls?.abandon || fallbackAbandon);
const pageError = computed(() => blockingVibe64SessionPageError({
  runtimePageError: selectedRuntimeState.value?.pageError,
  selectedSession: selection.selectedSession,
  selectedSessionLoadError: sessionData.selectedSessionView?.loadError,
  sessionListLoadError: sessionData.sessionList.loadError,
  sessions: toolbar.sessions || []
}));
const visiblePageError = computed(() => Boolean(
  pageError.value &&
  dismissedPageError.value !== pageError.value
));
const panelHeaderVisible = computed(() => Boolean(panelSessionToolbarVisible.value));

function dismissPageError() {
  dismissedPageError.value = String(pageError.value || "");
}

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

function ensureRuntimeHost(sessionId = "") {
  const key = String(sessionId || "");
  if (!key || mountedRuntimeSessionIds.value.includes(key)) {
    return;
  }
  mountedRuntimeSessionIds.value = [
    ...mountedRuntimeSessionIds.value,
    key
  ];
  ensureRuntimeState(key);
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
  mountedRuntimeSessionIds.value = mountedRuntimeSessionIds.value.filter((sessionId) => visibleSessionIds.has(sessionId));
  for (const sessionId of Object.keys(runtimeStateBySessionId)) {
    if (!visibleSessionIds.has(sessionId)) {
      delete runtimeStateBySessionId[sessionId];
    }
  }
  if (selection.selectedSession) {
    ensureRuntimeHost(selection.selectedSessionId);
  }
});

watch(() => [
  selection.selectedSessionId,
  selection.selectedSession ? "selected" : "empty"
].join("|"), () => {
  if (selection.selectedSession) {
    ensureRuntimeHost(selection.selectedSessionId);
  }
}, {
  immediate: true
});

watch(pageError, (error) => {
  if (!error) {
    dismissedPageError.value = "";
  }
});
</script>

<style scoped>
.studio-ai-sessions {
  display: grid;
  gap: 0.85rem;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  position: relative;
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

.studio-ai-sessions__empty-main {
  align-self: center;
  justify-self: center;
  min-width: 0;
  width: min(100%, 26rem);
}

.studio-ai-sessions__empty-layout {
  --studio-ai-sessions-codex-terminal-column: minmax(30rem, 1.22fr);
  --studio-ai-sessions-main-column: minmax(18rem, 0.78fr);
  --studio-ai-sessions-layout-gap: 0.9rem;
  display: grid;
  gap: var(--studio-ai-sessions-layout-gap);
  height: 100%;
  min-height: 0;
}

.studio-ai-sessions__empty {
  align-items: center;
  display: grid;
  gap: 0.75rem;
  justify-items: center;
  min-height: 14rem;
  padding: 1rem;
}

.studio-ai-sessions__empty-create {
  min-width: 11rem;
}

.studio-ai-sessions__empty-reason {
  margin: 0;
  max-width: 24rem;
  text-align: center;
}

.studio-ai-sessions__dashboard-empty-pane {
  min-height: 0;
  min-width: 0;
}

.studio-ai-sessions__header {
  display: grid;
  gap: 0.65rem;
}

.studio-ai-sessions__error-overlay {
  left: 0.85rem;
  max-width: min(42rem, calc(100% - 1.7rem));
  position: absolute;
  top: 0.85rem;
  z-index: 12;
}

.studio-ai-sessions-error-enter-active,
.studio-ai-sessions-error-leave-active {
  transition: opacity 120ms ease, transform 120ms ease;
}

.studio-ai-sessions-error-enter-from,
.studio-ai-sessions-error-leave-to {
  opacity: 0;
  transform: translateY(-0.35rem);
}

.studio-ai-sessions__runtime-stack {
  display: grid;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.studio-ai-sessions--autopilot .studio-ai-sessions__runtime-stack {
  height: 100%;
}

@media (min-width: 981px) {
  .studio-ai-sessions {
    grid-template-rows: auto minmax(0, 1fr);
  }

  .studio-ai-sessions--autopilot {
    grid-template-rows: minmax(0, 1fr);
  }

  .studio-ai-sessions--autopilot.studio-ai-sessions--with-header {
    grid-template-rows: auto minmax(0, 1fr);
  }

  .studio-ai-sessions__runtime-stack {
    min-height: 0;
  }

  .studio-ai-sessions__empty-layout--dashboard {
    --studio-ai-sessions-codex-terminal-column: minmax(30rem, 1fr);
    --studio-ai-sessions-main-column: minmax(13rem, 18rem);
    align-items: stretch;
    grid-template-columns: var(--studio-ai-sessions-main-column) var(--studio-ai-sessions-codex-terminal-column);
    height: 100%;
    overflow: hidden;
  }

  .studio-ai-sessions__empty-layout--dashboard .studio-ai-sessions__empty-main {
    width: min(100%, 16rem);
  }

  .studio-ai-sessions__empty-layout--dashboard .studio-ai-sessions__empty {
    min-height: 10rem;
    padding: 0.75rem;
  }

  .studio-ai-sessions__empty-layout--dashboard .studio-ai-sessions__empty-create {
    min-width: 9rem;
  }
}
</style>
