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
          :disabled="!canCreateWorktreeShell"
          :prepend-icon="mdiFolderOutline"
          :subtitle="worktreeShellMenuSubtitle"
          title="Worktree shell"
          @click="openShell('worktree')"
        />
        <v-list-item
          :disabled="!canCreateMainShell"
          :prepend-icon="mdiSourceRepository"
          :subtitle="mainShellMenuSubtitle"
          title="Main repo shell"
          @click="openShell('main')"
        />
      </v-list>
    </v-menu>

    <AiStudioFloatingTerminalWindow
      :displayed="terminalDisplayed"
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
            >
              <template #heading>
                <div
                  v-if="tab.id === activeShellTabId"
                  class="ai-studio-shell-controls__tabs"
                  :title="shellTabsShortcutTitle"
                >
                  <div
                    class="ai-studio-shell-controls__tab-list"
                    role="tablist"
                    @pointerdown.stop
                  >
                    <button
                      v-for="(shellTab, index) in shellTabs"
                      :key="shellTab.id"
                      type="button"
                      class="ai-studio-shell-controls__tab"
                      :class="{
                        'ai-studio-shell-controls__tab--active': shellTab.id === activeShellTabId
                      }"
                      :aria-selected="shellTab.id === activeShellTabId ? 'true' : 'false'"
                      role="tab"
                      :title="`Alt-${index + 1}: ${shellTab.label}`"
                      @click="selectShellTab(shellTab.id)"
                    >
                      <span>{{ shellTab.label }}</span>
                      <v-icon
                        v-if="shellTab.running"
                        class="ai-studio-shell-controls__tab-running"
                        :icon="mdiCircleSmall"
                        size="18"
                      />
                      <v-icon
                        :icon="mdiClose"
                        class="ai-studio-shell-controls__tab-close"
                        size="15"
                        title="Close tab"
                        @click.stop="closeShellTab(shellTab.id)"
                      />
                    </button>
                  </div>

                  <v-btn
                    class="ai-studio-shell-controls__new-tab"
                    :disabled="!canOpenNewTab"
                    :icon="mdiPlus"
                    size="small"
                    :title="newShellTabTitle"
                    variant="text"
                    @pointerdown.stop
                    @click="openNewShellTab"
                  />
                </div>
              </template>
            </AiStudioCommandTerminal>
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
  consumeShellShortcutEvent,
  MAX_SHELL_TABS,
  shellShortcutAction
} from "@/lib/aiStudioShellShortcuts.js";
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
  },
  windowDisplayed: {
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
const terminalDisplayed = computed(() => props.windowDisplayed !== false);
const shellShortcutsActive = computed(() => terminalVisible.value && terminalDisplayed.value);
const activeShellTab = computed(() => shellTabs.value.find((tab) => tab.id === activeShellTabId.value) || null);
const shellTabLimitReached = computed(() => shellTabs.value.length >= MAX_SHELL_TABS);
const shellTabLimitMessage = `Shell tabs are limited to ${MAX_SHELL_TABS}.`;
const canCreateMainShell = computed(() => Boolean(!shellTabLimitReached.value && canOpenMainShell.value));
const canCreateWorktreeShell = computed(() => Boolean(!shellTabLimitReached.value && canOpenWorktreeShell.value));
const shellWindowStorageKey = computed(() => {
  const source = props.session?.targetRoot || props.session?.sessionRoot || sessionId.value;
  return `ai-studio:floating-terminal:shell:${stableLocalStorageKeyPart(source)}`;
});
const canOpenNewTab = computed(() => {
  if (activeShellTab.value?.target) {
    return targetCanOpen(activeShellTab.value.target);
  }
  return canCreateWorktreeShell.value || canCreateMainShell.value;
});
const mainShellMenuSubtitle = computed(() => (shellTabLimitReached.value ? shellTabLimitMessage : "Project root"));
const newShellTabTitle = computed(() => (shellTabLimitReached.value ? shellTabLimitMessage : "New shell tab (Alt-N)"));
const shellTabsShortcutTitle = `Alt-N creates a tab. Alt-1 through Alt-${MAX_SHELL_TABS} switches tabs.`;
const worktreeShellMenuSubtitle = computed(() => {
  if (shellTabLimitReached.value) {
    return shellTabLimitMessage;
  }
  return worktreePath.value || "Create the session worktree first.";
});

function shellTargetTitle(target = "") {
  return target === "main" ? "Main repo shell" : "Worktree shell";
}

function nextShellTabLabel() {
  return `terminal ${shellTabSequence + 1}`;
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
    return canCreateWorktreeShell.value;
  }
  return target === "main" && canCreateMainShell.value;
}

function openShell(target) {
  createShellTab(target);
}

function createShellTab(target) {
  if (!targetCanOpen(target)) {
    return;
  }
  const tabLabel = nextShellTabLabel();
  const tabId = newShellTabId(target);
  shellTabs.value = [
    ...shellTabs.value,
    {
      id: tabId,
      label: tabLabel,
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

  const shortcut = shellShortcutAction(event);
  if (!shortcut) {
    return;
  }
  if (shortcut.type === "new-tab") {
    consumeShellShortcutEvent(event);
    openNewShellTab();
    return;
  }

  if (shortcut.type === "select-tab") {
    const tab = shellTabs.value[shortcut.tabIndex];
    if (tab) {
      consumeShellShortcutEvent(event);
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

watch(shellShortcutsActive, (visible) => {
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
  cursor: move;
  display: flex;
  gap: 0.3rem;
  min-height: 1.9rem;
  min-width: 0;
  user-select: none;
  width: 100%;
}

.ai-studio-shell-controls__tab-list {
  cursor: default;
  display: flex;
  flex: 1 1 auto;
  gap: 0.25rem;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.ai-studio-shell-controls__tab-list::-webkit-scrollbar {
  display: none;
}

.ai-studio-shell-controls__new-tab {
  flex: 0 0 auto;
}

.ai-studio-shell-controls__tab {
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: 5px;
  color: rgba(var(--v-theme-on-surface), 0.74);
  cursor: pointer;
  display: flex;
  flex: 1 1 4.8rem;
  font: inherit;
  font-size: 0.78rem;
  font-weight: 650;
  gap: 0.1rem;
  max-width: 8rem;
  min-width: 3rem;
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
