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
        <div
          v-if="sessionMode === 'inspect'"
          class="studio-ai-sessions__inspect-tools"
        >
          <v-btn
            v-if="inspectDiffVisible"
            class="studio-ai-sessions__inspect-button"
            :disabled="selectedReview.diffDisabled"
            :loading="selectedDiff.loading"
            :prepend-icon="mdiFileCompare"
            size="small"
            :title="selectedReview.diffTitle"
            type="button"
            variant="tonal"
            @click="selectedDiff.openDialog"
          >
            Review diff
          </v-btn>
        </div>

        <AiStudioShellControls
          v-for="shellSession in shellToolbarSessions"
          :key="`shell:${shellSession.sessionId}`"
          :session="shellSession"
          :show-activator="shellControlsActive(shellSession)"
          :window-displayed="shellControlsActive(shellSession)"
        />

        <AiStudioLaunchControls
          v-if="selectedToolbarSession"
          :key="`launch:${selectedToolbarSession.sessionId}`"
          button-size="large"
          button-variant="flat"
          :busy="false"
          class="studio-ai-sessions__run-controls"
          prominent
          :session="selectedToolbarSession"
          window-displayed
        />

        <v-btn
          class="studio-ai-sessions__mode-switch"
          :prepend-icon="modeSwitchIcon"
          type="button"
          variant="tonal"
          @click="switchSessionMode"
        >
          {{ modeSwitchLabel }}
        </v-btn>
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
        :key="selection.selectedSessionId"
        active
        :session-data="sessionData"
        :session-id="selection.selectedSessionId"
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
  mdiFileCompare,
  mdiPlayCircleOutline,
  mdiTune
} from "@mdi/js";
import AiStudioLaunchControls from "@/components/studio/AiStudioLaunchControls.vue";
import AiStudioSessionRuntimeHost from "@/components/studio/ai-studio-session/AiStudioSessionRuntimeHost.vue";
import AiStudioSessionToolbar from "@/components/studio/ai-studio-session/AiStudioSessionToolbar.vue";
import AiStudioShellControls from "@/components/studio/AiStudioShellControls.vue";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";
import {
  inspectDiffButtonVisible
} from "@/lib/aiStudioSessionPanelModel.js";
import {
  useAiStudioSessionData
} from "@/composables/useAiStudioSessionData.js";
import {
  aiStudioSessionDebugLog
} from "@/lib/aiStudioSessionDebugLog.js";

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
  createSession: sessionData.createSession,
  createSessionCommand: sessionData.createSessionCommand,
  createSessionMode: sessionData.createSessionMode,
  createSessionTitle: sessionData.createSessionTitle,
  selectSession: sessionData.selectSessionId,
  sessions: sessionData.sessions,
  shortSessionId: sessionData.shortSessionId,
  workflowDefinitions: sessionData.workflowDefinitions
});

const sessionMode = computed(() => route.query.mode === "inspect" ? "inspect" : "autopilot");
const modeSwitchTarget = computed(() => sessionMode.value === "inspect" ? "autopilot" : "inspect");
const modeSwitchLabel = computed(() => modeSwitchTarget.value === "inspect" ? "Inspect" : "Autopilot");
const modeSwitchIcon = computed(() => modeSwitchTarget.value === "inspect" ? mdiTune : mdiPlayCircleOutline);
const pageLoading = sessionData.pageLoading;
const selectedToolbarSession = computed(() => {
  return selection.selectedSession ||
    (toolbar.sessions || []).find((session) => session.sessionId === selection.selectedSessionId) ||
    null;
});
const shellToolbarSessions = computed(() => {
  return (toolbar.sessions || [])
    .map((session) => sessionData.sessionForId(session.sessionId) || session)
    .filter((session) => session?.sessionId);
});
const selectedRuntimeState = computed(() => runtimeStateBySessionId[selection.selectedSessionId] || null);
const selectedAbandon = computed(() => selectedRuntimeState.value?.toolbarControls?.abandon || fallbackAbandon);
const selectedDiff = computed(() => selectedRuntimeState.value?.toolbarControls?.diff || {});
const selectedReview = computed(() => selectedRuntimeState.value?.toolbarControls?.review || {});
const inspectDiffVisible = computed(() => {
  return inspectDiffButtonVisible({
    diff: selectedDiff.value,
    selectedSession: selection.selectedSession,
    sessionMode: sessionMode.value
  });
});
const pageError = computed(() => (
  sessionData.sessionList.loadError ||
  sessionData.selectedSessionView?.loadError ||
  selectedRuntimeState.value?.pageError ||
  ""
));

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

function setSessionMode(mode = "autopilot") {
  aiStudioSessionDebugLog("client.sessionPanel.setSessionMode", {
    fromMode: sessionMode.value,
    selectedSessionId: String(selection.selectedSessionId || ""),
    toMode: mode
  });
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

function switchSessionMode() {
  setSessionMode(modeSwitchTarget.value);
}

function shellControlsActive(session = {}) {
  return Boolean(
    sessionMode.value === "inspect" &&
    session?.sessionId &&
    session.sessionId === selection.selectedSessionId
  );
}

watch(sessionMode, () => {
  aiStudioSessionDebugLog("client.sessionPanel.sessionMode.changed", {
    selectedSessionId: String(selection.selectedSessionId || ""),
    sessionMode: sessionMode.value
  });
  if (selection.selectedSessionId) {
    void sessionData.refreshSessionData();
  }
});

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
  margin-left: auto;
  min-width: 0;
}

.studio-ai-sessions__inspect-tools,
.studio-ai-sessions__mode-switch,
.studio-ai-sessions__run-controls,
.studio-ai-sessions__inspect-button {
  flex: 0 0 auto;
}

.studio-ai-sessions__inspect-tools {
  align-items: center;
  display: flex;
  gap: 0.35rem;
  min-width: 0;
}

.studio-ai-sessions__mode-switch {
  min-width: 7.35rem;
}

@media (max-width: 600px) {
  .studio-ai-sessions__app-bar-actions {
    gap: 0.25rem;
  }

  .studio-ai-sessions__inspect-button {
    min-width: 0;
    padding-inline: 0.55rem;
  }

  .studio-ai-sessions__mode-switch {
    min-width: 6.75rem;
    padding-inline: 0.45rem;
  }
}
</style>
