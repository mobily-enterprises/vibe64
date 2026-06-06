<template>
  <v-sheet
    rounded="lg"
    class="studio-ai-sessions studio-ai-sessions--autopilot studio-screen__panel"
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
      v-if="emptyLayoutVisible"
      class="studio-ai-sessions__empty-layout"
      :class="{
        'studio-ai-sessions__empty-layout--chat-collapsed': chatCollapsed,
        'studio-ai-sessions__empty-layout--dashboard': dashboardWorkspaceActive
      }"
    >
      <section
        class="studio-ai-sessions__empty-main"
        aria-label="Session chat"
      >
        <div class="studio-ai-sessions__empty-session-header">
          <Vibe64SessionToolbar
            :abandon="selectedAbandon"
            compact
            :create-attention="emptyCreateAttention"
            :create-visible="!emptyStateLoading"
            :max-visible-sessions="3"
            :selected-session-id="selection.selectedSessionId"
            :selection-closed="selection.isClosed"
            :toolbar="toolbar"
          />
        </div>
        <div class="studio-ai-sessions__empty-chat-body">
          <div
            v-if="emptyChatHintText"
            class="studio-ai-sessions__empty-hint"
            role="status"
          >
            {{ emptyChatHintText }}
          </div>
        </div>
        <div
          class="studio-ai-sessions__empty-thinking studio-ai-sessions__empty-thinking--empty"
          aria-hidden="true"
        >
          <span class="studio-ai-sessions__empty-thinking-mark" />
          <span>Thinking...</span>
        </div>
        <div class="studio-ai-sessions__empty-runtime-status" />
        <div class="studio-ai-sessions__empty-composer" />
      </section>

      <section
        class="studio-ai-sessions__empty-workspace-panel"
        aria-label="Workspace"
      >
        <div
          v-if="dashboardWorkspaceActive"
          class="studio-ai-sessions__dashboard-empty-pane"
        >
          <slot name="dashboard" :dashboard-context="emptyDashboardContext" />
        </div>
        <div
          v-else
          class="studio-ai-sessions__preview-empty-pane"
        >
          <div class="studio-ai-sessions__preview-empty-content">
            <p class="studio-ai-sessions__preview-empty-title">
              {{ emptyPreviewTitleText }}
            </p>
            <p
              v-if="emptyPreviewDetailText"
              class="studio-ai-sessions__preview-empty-detail"
            >
              {{ emptyPreviewDetailText }}
            </p>
            <div
              v-if="emptyStateLoading"
              class="studio-ai-sessions__preview-empty-loading"
              role="status"
            >
              <v-progress-circular
                indeterminate
                size="20"
                width="2"
              />
              <span>Loading sessions.</span>
            </div>
            <Vibe64CreateSessionButton
              v-else
              aria-label="Create session"
              button-class="studio-ai-sessions__preview-create-button"
              :icon-only="false"
              label="Create session"
              menu-location="bottom center"
              :toolbar="toolbar"
            />
          </div>
        </div>
      </section>
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
const chatCollapsed = computed(() => Boolean(props.chatCollapsed));
const dashboardWorkspaceActive = computed(() => workspacePane.value === "dashboard");
const emptyDashboardContext = Object.freeze({});
const emptyBlockedReason = computed(() => String(
  !toolbar.canCreateSession && toolbar.createSessionTitle ? toolbar.createSessionTitle : ""
).trim());
const emptyChatHintText = computed(() => {
  if (emptyStateLoading.value) {
    return "Loading sessions.";
  }
  return emptyBlockedReason.value || "Use the + button to start a session.";
});
const emptyPreviewTitleText = computed(() => {
  return emptyStateLoading.value ? "Loading session." : "Create a session to start preview.";
});
const emptyPreviewDetailText = computed(() => {
  if (emptyStateLoading.value) {
    return "";
  }
  return emptyBlockedReason.value;
});
const emptyCreateAttention = computed(() => Boolean(
  !emptyStateLoading.value &&
  toolbar.canCreateSession &&
  (toolbar.sessions || []).length < 1
));
const selectedRuntimeState = computed(() => runtimeStateBySessionId[selection.selectedSessionId] || null);
const runtimeHostSessionIds = computed(() => {
  const visibleSessionIds = new Set((toolbar.sessions || []).map((session) => session.sessionId));
  if (selection.selectedSession && selection.selectedSessionId) {
    visibleSessionIds.add(selection.selectedSessionId);
  }
  return mountedRuntimeSessionIds.value.filter((sessionId) => visibleSessionIds.has(sessionId));
});
const emptyStateLoading = computed(() => Boolean(
  sessionData.sessionList.isInitialLoading &&
  !selection.selectedSession &&
  runtimeHostSessionIds.value.length < 1
));
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

.studio-ai-sessions__empty-layout {
  --studio-ai-sessions-layout-gap: 0.9rem;
  display: grid;
  gap: var(--studio-ai-sessions-layout-gap);
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

.studio-ai-sessions__empty-main,
.studio-ai-sessions__empty-workspace-panel {
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-outline), 0.14);
  border-radius: 14px;
  box-shadow: 0 0.75rem 2rem rgba(15, 23, 42, 0.06);
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

.studio-ai-sessions__empty-main,
.studio-ai-sessions__empty-workspace-panel,
.studio-ai-sessions__preview-empty-pane {
  display: grid;
}

.studio-ai-sessions__empty-main {
  gap: 0.16rem;
  grid-template-rows: auto minmax(0, 1fr) auto auto auto;
  overflow: visible;
  padding: 0.05rem 0.65rem 0.18rem;
}

.studio-ai-sessions__empty-session-header {
  display: grid;
  gap: 0.28rem;
  min-width: 0;
}

.studio-ai-sessions__empty-chat-body {
  align-items: start;
  display: grid;
  min-height: 0;
  overflow: hidden;
  padding: 0.25rem 0.1rem 0 0;
  scrollbar-gutter: stable;
}

.studio-ai-sessions__empty-hint {
  background: rgba(var(--v-theme-primary), 0.08);
  border: 1px solid rgba(var(--v-theme-primary), 0.16);
  border-radius: 10px;
  color: rgba(var(--v-theme-on-surface), 0.76);
  font-size: 0.86rem;
  line-height: 1.35;
  max-width: 100%;
  padding: 0.55rem 0.65rem;
}

.studio-ai-sessions__empty-thinking {
  align-items: center;
  color: rgba(var(--v-theme-on-surface), 0.72);
  display: flex;
  font-size: 0.86rem;
  gap: 0.38rem;
  min-height: 1.35rem;
}

.studio-ai-sessions__empty-thinking--empty {
  visibility: hidden;
}

.studio-ai-sessions__empty-thinking-mark {
  background: rgb(var(--v-theme-primary));
  border-radius: 999px;
  box-shadow: 0 0 0 0.24rem rgba(var(--v-theme-primary), 0.12);
  height: 0.48rem;
  width: 0.48rem;
}

.studio-ai-sessions__empty-runtime-status {
  display: none;
}

.studio-ai-sessions__empty-composer {
  min-height: 0.35rem;
  min-width: 0;
}

.studio-ai-sessions__dashboard-empty-pane {
  align-content: start;
  display: grid;
  gap: 0.75rem;
  min-height: 0;
  min-width: 0;
  overflow-y: auto;
  padding: 0.85rem;
  scrollbar-gutter: stable;
}

.studio-ai-sessions__preview-empty-pane {
  align-items: center;
  justify-items: center;
  min-height: 0;
  min-width: 0;
  padding: 1rem;
}

.studio-ai-sessions__preview-empty-content {
  align-items: center;
  display: grid;
  gap: 0.65rem;
  justify-items: center;
  max-width: min(100%, 26rem);
  text-align: center;
}

.studio-ai-sessions__preview-empty-title {
  color: rgba(var(--v-theme-on-surface), 0.78);
  font-size: 0.98rem;
  line-height: 1.35;
  margin: 0;
}

.studio-ai-sessions__preview-empty-detail {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.86rem;
  line-height: 1.35;
  margin: -0.25rem 0 0;
  max-width: 24rem;
}

.studio-ai-sessions__preview-empty-loading {
  align-items: center;
  color: rgba(var(--v-theme-on-surface), 0.62);
  display: inline-flex;
  font-size: 0.86rem;
  gap: 0.55rem;
  justify-content: center;
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

  .studio-ai-sessions__empty-layout {
    grid-template-columns:
      minmax(
        var(--studio-home-chat-column-min-width, 24rem),
        var(--studio-home-chat-column-width, 30rem)
      )
      minmax(0, 1fr);
  }

  .studio-ai-sessions__empty-layout--chat-collapsed {
    grid-template-columns: minmax(0, 1fr);
  }

  .studio-ai-sessions__empty-layout--chat-collapsed .studio-ai-sessions__empty-main {
    display: none;
  }

  .studio-ai-sessions__runtime-stack {
    min-height: 0;
  }

  .studio-ai-sessions__empty-layout--dashboard {
    align-items: stretch;
    height: 100%;
    overflow: hidden;
  }
}

@media (max-width: 980px) {
  .studio-ai-sessions__empty-layout {
    grid-template-rows: minmax(0, 1fr);
  }

  .studio-ai-sessions__empty-workspace-panel {
    display: none;
  }

  .studio-ai-sessions__empty-layout--chat-collapsed .studio-ai-sessions__empty-main {
    display: none;
  }

  .studio-ai-sessions__empty-layout--chat-collapsed .studio-ai-sessions__empty-workspace-panel {
    display: grid;
  }
}
</style>
