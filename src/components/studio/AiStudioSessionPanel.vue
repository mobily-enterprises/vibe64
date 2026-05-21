<template>
  <v-sheet rounded="lg" class="studio-ai-sessions studio-screen__panel">
    <div class="studio-ai-sessions__header">
      <StudioErrorNotice
        v-if="pageError"
        title="AI Studio sessions could not load"
        :error="pageError"
        compact
      />

      <AiStudioSessionToolbar
        :abandon="selectedAbandon"
        :selected-session-id="selection.selectedSessionId"
        :selection-closed="selection.isClosed"
        :toolbar="toolbar"
      />
    </div>

    <Teleport
      defer
      to="#studio-home-app-bar-actions"
    >
      <div
        v-if="selection.selectedSession"
        class="studio-ai-sessions__app-bar-actions"
      >
        <v-btn
          class="studio-ai-sessions__inspect-button"
          :prepend-icon="inspectButtonIcon"
          size="small"
          variant="tonal"
          @click="toggleInspectMode"
        >
          {{ inspectButtonLabel }}
        </v-btn>

        <AiStudioLaunchControls
          v-for="sessionItem in toolbar.sessions"
          v-show="sessionItem.sessionId === selection.selectedSessionId"
          :key="`launch:${sessionItem.sessionId}`"
          :busy="false"
          :fix-command-failure="fixCommandFailureForSession(sessionItem.sessionId)"
          :session="sessionItem"
          :window-displayed="sessionItem.sessionId === selection.selectedSessionId"
        />

        <AiStudioShellControls
          :busy="interactionBusy"
          :fix-command-failure="selectedFixCommandFailure"
          :session="selection.selectedSession"
          :show-activator="sessionMode === 'inspect'"
          :window-displayed="sessionMode === 'inspect'"
        />
      </div>
    </Teleport>

    <v-progress-linear
      v-if="pageLoading && !selection.selectedSession"
      color="primary"
      height="6"
      indeterminate
      rounded
    />

    <v-sheet
      v-else-if="!selection.selectedSession"
      rounded="lg"
      border
      class="studio-ai-sessions__empty"
    >
      <p class="text-body-2 text-medium-emphasis mb-0">No sessions yet.</p>
    </v-sheet>

    <div v-else class="studio-ai-sessions__runtime-stack">
      <AiStudioSessionRuntimeHost
        v-for="sessionItem in toolbar.sessions"
        v-show="sessionItem.sessionId === selection.selectedSessionId"
        :key="sessionItem.sessionId"
        :active="sessionItem.sessionId === selection.selectedSessionId"
        :session-data="sessionData"
        :session-id="sessionItem.sessionId"
        :session-mode="sessionMode"
        @busy-change="setRuntimeBusy"
        @page-error-change="setRuntimePageError"
        @toolbar-controls-ready="setRuntimeToolbarControls"
      />
    </div>
  </v-sheet>
</template>

<script setup>
import { computed, proxyRefs, reactive, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  mdiClose,
  mdiTune
} from "@mdi/js";
import AiStudioLaunchControls from "@/components/studio/AiStudioLaunchControls.vue";
import AiStudioSessionRuntimeHost from "@/components/studio/ai-studio-session/AiStudioSessionRuntimeHost.vue";
import AiStudioSessionToolbar from "@/components/studio/ai-studio-session/AiStudioSessionToolbar.vue";
import AiStudioShellControls from "@/components/studio/AiStudioShellControls.vue";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";
import {
  useAiStudioSessionData
} from "@/composables/useAiStudioSessionData.js";

const emit = defineEmits(["title-change"]);
const route = useRoute();
const router = useRouter();

const fallbackAbandon = {
  command: {
    isRunning: false
  },
  request: () => null
};
const runtimeStateBySessionId = reactive({});
const sessionData = useAiStudioSessionData({
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
  createSessionCommand: sessionData.createSessionCommand,
  createSessionTitle: sessionData.createSessionTitle,
  selectSession: sessionData.selectSessionId,
  sessions: sessionData.sessions,
  shortSessionId: sessionData.shortSessionId
});

const sessionMode = computed(() => route.query.mode === "inspect" ? "inspect" : "autopilot");
const inspectButtonIcon = computed(() => sessionMode.value === "inspect" ? mdiClose : mdiTune);
const inspectButtonLabel = computed(() => sessionMode.value === "inspect" ? "Quit inspect" : "Inspect");
const pageLoading = sessionData.pageLoading;
const selectedRuntimeState = computed(() => runtimeStateBySessionId[selection.selectedSessionId] || null);
const selectedRuntimeReady = computed(() => Boolean(selectedRuntimeState.value?.toolbarControls));
const selectedAbandon = computed(() => selectedRuntimeState.value?.toolbarControls?.abandon || fallbackAbandon);
const selectedFixCommandFailure = computed(() => selectedRuntimeState.value?.toolbarControls?.fixCommandFailure || null);
const interactionBusy = computed(() => Boolean(
  selection.selectedSession && !selectedRuntimeReady.value
) || Boolean(selectedRuntimeState.value?.busy));
const pageError = computed(() => sessionData.sessionList.loadError || selectedRuntimeState.value?.pageError || "");

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

function fixCommandFailureForSession(sessionId = "") {
  return runtimeStateBySessionId[String(sessionId || "")]?.toolbarControls?.fixCommandFailure || null;
}

function setSessionMode(mode = "autopilot") {
  const query = {
    ...route.query
  };
  if (mode === "inspect") {
    query.mode = "inspect";
  } else {
    delete query.mode;
  }
  void router.replace({
    query
  });
}

function toggleInspectMode() {
  setSessionMode(sessionMode.value === "inspect" ? "autopilot" : "inspect");
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

.studio-ai-sessions__empty {
  padding: 0.9rem;
}

.studio-ai-sessions__header {
  display: grid;
  gap: 0.65rem;
}

.studio-ai-sessions__runtime-stack {
  display: grid;
  min-height: 0;
}

@media (min-width: 981px) {
  .studio-ai-sessions {
    grid-template-rows: auto minmax(0, 1fr);
    height: 100%;
    overflow: hidden;
  }

  .studio-ai-sessions__runtime-stack {
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }
}

.studio-ai-sessions__app-bar-actions {
  align-items: center;
  display: flex;
  gap: 0.35rem;
  justify-content: flex-end;
  min-width: 0;
}

.studio-ai-sessions__inspect-button {
  flex: 0 0 auto;
}

@media (max-width: 600px) {
  .studio-ai-sessions__app-bar-actions {
    gap: 0.25rem;
  }

  .studio-ai-sessions__inspect-button {
    min-width: 0;
    padding-inline: 0.55rem;
  }
}
</style>
