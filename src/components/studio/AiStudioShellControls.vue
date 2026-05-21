<template>
  <div v-if="sessionId" class="ai-studio-shell-controls">
    <v-menu v-if="showActivator" location="bottom end">
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

    <AiStudioFloatingTerminalWindow
      minimized-width="min(24rem, calc(100vw - 1.5rem))"
      :minimized="terminalMinimized"
      :storage-key="shellWindowStorageKey"
      :visible="terminalVisible"
    >
      <template #default="{ startDrag }">
        <div
          class="ai-studio-shell-controls__window"
          :class="{
            'ai-studio-shell-controls__window--minimized': terminalMinimized
          }"
        >
          <div
            v-if="!terminalMinimized"
            class="ai-studio-shell-controls__tabs"
            title="Alt-N creates a tab. Alt-1 through Alt-9 switches tabs."
            @pointerdown="startDrag"
          >
            <div class="ai-studio-shell-controls__tab-list" @pointerdown.stop>
              <button
                v-for="(tab, index) in shellTabs"
                :key="tab.id"
                type="button"
                class="ai-studio-shell-controls__tab"
                :class="{
                  'ai-studio-shell-controls__tab--active': tab.id === activeShellTabId
                }"
                :aria-selected="tab.id === activeShellTabId ? 'true' : 'false'"
                :title="`Alt-${index + 1}: ${tab.label}`"
                @click="selectShellTab(tab.id)"
              >
                <span>{{ tab.label }}</span>
                <v-icon
                  v-if="tab.running"
                  class="ai-studio-shell-controls__tab-running"
                  :icon="mdiCircleSmall"
                  size="18"
                />
                <v-icon
                  :icon="mdiClose"
                  class="ai-studio-shell-controls__tab-close"
                  size="15"
                  title="Close tab"
                  @click.stop="closeShellTab(tab.id)"
                />
              </button>
            </div>

            <v-btn
              class="ai-studio-shell-controls__new-tab"
              :disabled="!canOpenNewTab"
              :icon="mdiPlus"
              size="small"
              title="New shell tab (Alt-N)"
              variant="text"
              @pointerdown.stop
              @click="openNewShellTab"
            />
          </div>

          <div class="ai-studio-shell-controls__terminal-stack">
            <AiStudioCommandTerminal
              v-for="tab in shellTabs"
              :key="tab.id"
              :ref="(terminalComponent) => setShellTerminalRef(tab.id, terminalComponent)"
              class="ai-studio-shell-controls__terminal"
              :class="{
                'ai-studio-shell-controls__terminal--active': tab.id === activeShellTabId
              }"
              :ai-fix-available="Boolean(fixCommandFailure)"
              draggable
              :reuse-running="false"
              terminal-kind="shell"
              :session="tab.session"
              :shell-target="tab.target"
              :start-request-key="tab.startKey"
              :title="tab.title"
              @closed="closeShellTab(tab.id)"
              @drag-start="startDrag"
              @expanded-changed="handleTerminalExpandedChanged(tab.id, $event)"
              @fix-requested="handleFixRequested"
              @running-changed="handleRunningChanged(tab.id, $event)"
            />
          </div>
        </div>
      </template>
    </AiStudioFloatingTerminalWindow>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import {
  mdiCircleSmall,
  mdiClose,
  mdiConsoleLine,
  mdiFolderOutline,
  mdiPlus,
  mdiSourceRepository
} from "@mdi/js";
import AiStudioCommandTerminal from "@/components/studio/AiStudioCommandTerminal.vue";
import AiStudioFloatingTerminalWindow from "@/components/studio/AiStudioFloatingTerminalWindow.vue";
import {
  aiStudioSessionWorktreePath
} from "@/lib/aiStudioSessionPaths.js";
import {
  stableLocalStorageKeyPart
} from "@/lib/browserLocalStorage.js";

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
  },
  showActivator: {
    type: Boolean,
    default: true
  }
});

const activeShellTabId = ref("");
const shellTabs = ref([]);
const terminalMinimized = ref(false);
const shellTerminalRefs = new Map();
let shellTabSequence = 0;
let shortcutListenerActive = false;

const sessionId = computed(() => String(props.session?.sessionId || ""));
const worktreePath = computed(() => aiStudioSessionWorktreePath(props.session || {}));
const menuDisabled = computed(() => !sessionId.value);
const canOpenMainShell = computed(() => Boolean(sessionId.value && !menuDisabled.value));
const canOpenWorktreeShell = computed(() => Boolean(canOpenMainShell.value && worktreePath.value));
const terminalVisible = computed(() => shellTabs.value.length > 0);
const activeShellTab = computed(() => shellTabs.value.find((tab) => tab.id === activeShellTabId.value) || null);
const shellWindowStorageKey = computed(() => {
  const source = props.session?.targetRoot || props.session?.sessionRoot || sessionId.value;
  return `ai-studio:floating-terminal:shell:${stableLocalStorageKeyPart(source)}`;
});
const canOpenNewTab = computed(() => Boolean(
  activeShellTab.value ||
  canOpenWorktreeShell.value ||
  canOpenMainShell.value
));

function shellTargetLabel(target = "") {
  return target === "main" ? "Main" : "Worktree";
}

function shellTargetTitle(target = "") {
  return target === "main" ? "Main repo shell" : "Worktree shell";
}

function nextShellTabLabel(target = "") {
  const targetLabel = shellTargetLabel(target);
  const tabNumber = shellTabs.value.filter((tab) => tab.target === target).length + 1;
  return `${targetLabel} ${tabNumber}`;
}

function newShellTabId(target = "") {
  shellTabSequence += 1;
  return `${sessionId.value}:shell:${target}:${Date.now()}:${shellTabSequence}`;
}

function defaultNewTabTarget() {
  if (activeShellTab.value?.target) {
    return activeShellTab.value.target;
  }
  return canOpenWorktreeShell.value ? "worktree" : "main";
}

function targetCanOpen(target = "") {
  if (target === "worktree") {
    return canOpenWorktreeShell.value;
  }
  return target === "main" && canOpenMainShell.value;
}

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
  createShellTab(target);
}

function createShellTab(target) {
  if (!targetCanOpen(target)) {
    return;
  }
  const tabId = newShellTabId(target);
  shellTabs.value = [
    ...shellTabs.value,
    {
      id: tabId,
      label: nextShellTabLabel(target),
      running: false,
      session: props.session,
      startKey: `${tabId}:start`,
      target,
      title: shellTargetTitle(target)
    }
  ];
  activeShellTabId.value = tabId;
  terminalMinimized.value = false;
  void focusShellTab(tabId);
}

function openNewShellTab() {
  createShellTab(defaultNewTabTarget());
}

function selectShellTab(tabId = "") {
  if (!shellTabs.value.some((tab) => tab.id === tabId)) {
    return;
  }
  activeShellTabId.value = tabId;
  terminalMinimized.value = false;
  void focusShellTab(tabId);
}

function closeShell() {
  shellTabs.value = [];
  activeShellTabId.value = "";
  terminalMinimized.value = false;
  shellTerminalRefs.clear();
}

function closeShellTab(tabId = "") {
  const tabIndex = shellTabs.value.findIndex((tab) => tab.id === tabId);
  if (tabIndex < 0) {
    return;
  }

  const nextTabs = shellTabs.value.filter((tab) => tab.id !== tabId);
  shellTabs.value = nextTabs;
  if (activeShellTabId.value !== tabId) {
    return;
  }
  const fallbackTab = nextTabs[Math.min(tabIndex, nextTabs.length - 1)] || null;
  activeShellTabId.value = fallbackTab?.id || "";
  if (!fallbackTab) {
    terminalMinimized.value = false;
    return;
  }
  void focusShellTab(fallbackTab.id);
}

function setShellTerminalRef(tabId = "", terminalComponent = null) {
  if (!tabId) {
    return;
  }
  if (terminalComponent) {
    shellTerminalRefs.set(tabId, terminalComponent);
    return;
  }
  shellTerminalRefs.delete(tabId);
}

async function focusShellTab(tabId = activeShellTabId.value) {
  await nextTick();
  shellTerminalRefs.get(tabId)?.focus?.();
}

function handleRunningChanged(tabId = "", nextRunning = false) {
  const tab = shellTabs.value.find((item) => item.id === tabId);
  if (tab) {
    tab.running = Boolean(nextRunning);
  }
}

function handleTerminalExpandedChanged(tabId = "", expanded = true) {
  if (tabId !== activeShellTabId.value) {
    return;
  }
  terminalMinimized.value = expanded !== true;
  if (terminalMinimized.value && typeof document !== "undefined") {
    document.activeElement?.blur?.();
  }
}

function handleFixRequested(payload) {
  return props.fixCommandFailure?.(payload);
}

function handleShellShortcut(event) {
  if (!terminalVisible.value || event.defaultPrevented) {
    return;
  }

  const key = String(event.key || "").toLowerCase();
  if (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && key === "t") {
    event.preventDefault();
    openNewShellTab();
    return;
  }

  if (event.altKey && !event.ctrlKey && !event.shiftKey && !event.metaKey && key === "n") {
    event.preventDefault();
    openNewShellTab();
    return;
  }

  if (event.altKey && !event.ctrlKey && !event.shiftKey && !event.metaKey && /^[1-9]$/u.test(key)) {
    const tab = shellTabs.value[Number(key) - 1];
    if (tab) {
      event.preventDefault();
      selectShellTab(tab.id);
    }
  }
}

function startShellShortcuts() {
  if (shortcutListenerActive || typeof window === "undefined") {
    return;
  }
  shortcutListenerActive = true;
  window.addEventListener("keydown", handleShellShortcut, true);
}

function stopShellShortcuts() {
  if (!shortcutListenerActive || typeof window === "undefined") {
    return;
  }
  shortcutListenerActive = false;
  window.removeEventListener("keydown", handleShellShortcut, true);
}

watch(sessionId, () => {
  closeShell();
});

watch(terminalVisible, (visible) => {
  if (visible) {
    startShellShortcuts();
  } else {
    stopShellShortcuts();
  }
}, {
  immediate: true
});

onBeforeUnmount(stopShellShortcuts);
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

.ai-studio-shell-controls__window {
  display: flex;
  flex-direction: column;
  gap: 0;
  height: 100%;
  min-height: 0;
}

.ai-studio-shell-controls__window--minimized {
  display: block;
}

.ai-studio-shell-controls__tabs {
  align-items: center;
  background: rgba(var(--v-theme-surface), 0.98);
  border: 1px solid rgba(var(--v-theme-outline), 0.24);
  border-bottom: 0;
  border-radius: 7px;
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
  cursor: move;
  display: flex;
  gap: 0.3rem;
  min-height: 2rem;
  min-width: 0;
  padding: 0.2rem;
  user-select: none;
}

.ai-studio-shell-controls__window--minimized .ai-studio-shell-controls__tabs {
  display: none;
}

.ai-studio-shell-controls__tab-list {
  display: flex;
  flex: 0 1 auto;
  gap: 0.25rem;
  max-width: calc(100% - 2.4rem);
  min-width: 0;
  overflow-x: auto;
}

.ai-studio-shell-controls__new-tab {
  flex: 0 0 auto;
  margin-left: 0.1rem;
}

.ai-studio-shell-controls__tab {
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: 5px;
  color: rgba(var(--v-theme-on-surface), 0.74);
  cursor: pointer;
  display: flex;
  flex: 0 0 auto;
  font: inherit;
  font-size: 0.78rem;
  font-weight: 650;
  gap: 0.1rem;
  max-width: 12rem;
  min-width: 0;
  padding: 0.25rem 0.32rem 0.25rem 0.5rem;
}

.ai-studio-shell-controls__tab:hover,
.ai-studio-shell-controls__tab--active {
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-on-surface));
}

.ai-studio-shell-controls__tab span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-studio-shell-controls__tab-running {
  color: rgb(var(--v-theme-success));
  flex: 0 0 auto;
}

.ai-studio-shell-controls__tab-close {
  border-radius: 999px;
  flex: 0 0 auto;
  opacity: 0.62;
}

.ai-studio-shell-controls__tab-close:hover {
  background: rgba(var(--v-theme-on-surface), 0.12);
  opacity: 1;
}

.ai-studio-shell-controls__terminal-stack {
  flex: 1 1 auto;
  min-height: 0;
  position: relative;
}

.ai-studio-shell-controls__window--minimized .ai-studio-shell-controls__terminal-stack {
  display: block;
  position: static;
}

.ai-studio-shell-controls__terminal {
  height: 100%;
  inset: 0;
  pointer-events: none;
  position: absolute;
  visibility: hidden;
  width: 100%;
}

.ai-studio-shell-controls__terminal--active {
  pointer-events: auto;
  visibility: visible;
}

.ai-studio-shell-controls__terminal :deep(.ai-command-terminal) {
  border-top-left-radius: 0;
  border-top-right-radius: 0;
}

.ai-studio-shell-controls__window--minimized .ai-studio-shell-controls__terminal {
  display: none;
  height: auto;
  position: static;
  visibility: visible;
  width: auto;
}

.ai-studio-shell-controls__window--minimized .ai-studio-shell-controls__terminal--active {
  display: block;
}
</style>
