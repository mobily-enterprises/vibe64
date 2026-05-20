<template>
  <div v-if="sessionId" class="ai-studio-shell-controls">
    <v-menu location="bottom end">
      <template #activator="{ props: menuProps }">
        <v-btn
          v-bind="menuProps"
          :disabled="menuDisabled"
          :icon="mdiConsoleLine"
          size="small"
          title="Open shell"
          variant="tonal"
          aria-label="Open shell"
        />
      </template>

      <v-list class="ai-studio-shell-controls__menu" density="compact">
        <v-list-item
          :disabled="!canOpenWorktreeShell"
          :prepend-icon="mdiFolderOutline"
          :subtitle="worktreePath || 'Create the session worktree first.'"
          title="Worktree shell"
          @click="openShell('worktree')"
        />
        <v-list-item
          :disabled="!canOpenMainShell"
          :prepend-icon="mdiSourceRepository"
          subtitle="Project root"
          title="Main repo shell"
          @click="openShell('main')"
        />
      </v-list>
    </v-menu>

    <v-dialog
      v-model="terminalVisible"
      max-width="min(92vw, 72rem)"
      persistent
    >
      <AiStudioCommandTerminal
        class="ai-studio-shell-controls__terminal"
        :ai-fix-available="Boolean(fixCommandFailure)"
        terminal-kind="shell"
        :session="activeSession"
        :shell-target="activeTarget"
        :start-request-key="startKey"
        :title="terminalTitle"
        @closed="closeShell"
        @fix-requested="handleFixRequested"
        @running-changed="handleRunningChanged"
      />
    </v-dialog>
  </div>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import {
  mdiConsoleLine,
  mdiFolderOutline,
  mdiSourceRepository
} from "@mdi/js";
import AiStudioCommandTerminal from "@/components/studio/AiStudioCommandTerminal.vue";
import {
  aiStudioSessionWorktreePath
} from "@/lib/aiStudioSessionPaths.js";

const props = defineProps({
  busy: {
    type: Boolean,
    default: false
  },
  fixCommandFailure: {
    type: Function,
    default: null
  },
  session: {
    type: Object,
    default: null
  }
});

const activeSession = ref(null);
const activeTarget = ref("");
const startKey = ref("");
const terminalRunning = ref(false);
const terminalVisible = ref(false);

const sessionId = computed(() => String(props.session?.sessionId || ""));
const worktreePath = computed(() => aiStudioSessionWorktreePath(props.session || {}));
const menuDisabled = computed(() => Boolean(props.busy || terminalRunning.value));
const canOpenMainShell = computed(() => Boolean(sessionId.value && !menuDisabled.value));
const canOpenWorktreeShell = computed(() => Boolean(canOpenMainShell.value && worktreePath.value));
const terminalTitle = computed(() => {
  return activeTarget.value === "main" ? "Main repo shell" : "Worktree shell";
});

function openShell(target) {
  if (target !== "worktree" && target !== "main") {
    return;
  }
  if (target === "worktree" && !canOpenWorktreeShell.value) {
    return;
  }
  if (target === "main" && !canOpenMainShell.value) {
    return;
  }
  activeSession.value = props.session;
  activeTarget.value = target;
  terminalVisible.value = true;
  startKey.value = `${sessionId.value}:shell:${target}:${Date.now()}`;
}

function closeShell() {
  activeSession.value = null;
  activeTarget.value = "";
  startKey.value = "";
  terminalRunning.value = false;
  terminalVisible.value = false;
}

function handleRunningChanged(nextRunning) {
  terminalRunning.value = Boolean(nextRunning);
}

function handleFixRequested(payload) {
  return props.fixCommandFailure?.(payload);
}

watch(sessionId, () => {
  closeShell();
});
</script>

<style scoped>
.ai-studio-shell-controls {
  align-items: center;
  display: inline-flex;
  min-width: 0;
}

.ai-studio-shell-controls__menu {
  max-width: min(22rem, 92vw);
  min-width: min(18rem, 92vw);
}

.ai-studio-shell-controls__terminal {
  height: min(72vh, 44rem);
}
</style>
