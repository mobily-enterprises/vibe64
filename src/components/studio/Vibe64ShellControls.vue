<template>
  <div
    v-if="sessionId"
    class="vibe64-shell-controls"
    :class="{ 'vibe64-shell-controls--embedded': embedded }"
  >
    <div
      v-if="embedded && !hasShellTabs"
      class="vibe64-shell-controls__empty"
    >
      <p>Open a shell for this session.</p>
      <div class="vibe64-shell-controls__empty-actions">
        <v-btn
          class="vibe64-shell-controls__empty-action"
          color="primary"
          :disabled="!canCreateWorktreeShell"
          :prepend-icon="mdiFolderOutline"
          size="large"
          type="button"
          variant="tonal"
          @click="openShell('worktree')"
        >
          Worktree shell
        </v-btn>
        <v-btn
          class="vibe64-shell-controls__empty-action"
          :disabled="!canCreateMainShell"
          :prepend-icon="mdiSourceRepository"
          size="large"
          type="button"
          variant="tonal"
          @click="openShell('main')"
        >
          Main repo shell
        </v-btn>
      </div>
    </div>

    <v-menu v-else-if="showShellTargetMenu" location="bottom end">
      <template #activator="{ props: menuProps }">
        <v-btn
          v-bind="menuProps"
          :color="shellActivatorColor"
          :disabled="menuDisabled"
          :icon="shellActivatorIcon"
          size="small"
          :title="shellActivatorTitle"
          variant="tonal"
          :aria-label="shellActivatorTitle"
        />
      </template>

      <v-list class="vibe64-shell-controls__menu" density="compact">
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

    <v-btn
      v-else-if="showActivator"
      :color="shellActivatorColor"
      :icon="shellActivatorIcon"
      size="small"
      :title="shellActivatorTitle"
      variant="tonal"
      :aria-label="shellActivatorTitle"
      @click="toggleShellPanel"
    />

    <Teleport
      v-if="hasShellTabs"
      defer
      to="body"
      :disabled="embedded"
    >
      <div
        class="vibe64-shell-controls__inline-panel"
        :class="{
          'vibe64-shell-controls__inline-panel--embedded': embedded,
          'vibe64-shell-controls__inline-panel--displayed': shellPanelOpen,
          'vibe64-shell-controls__inline-panel--hidden': !shellPanelOpen
        }"
        :style="shellPanelStyle"
      >
        <div class="vibe64-shell-controls__window">
          <div class="vibe64-shell-controls__terminal-stack">
            <Vibe64CommandTerminal
              v-for="tab in shellTabs"
              :key="tab.id"
              :ref="(terminalComponent) => setShellTerminalRef(tab.id, terminalComponent)"
              class="vibe64-shell-controls__terminal"
              :class="{
                'vibe64-shell-controls__terminal--active': tab.id === activeShellTabId
              }"
              emit-closed-before-server-ack
              :close-on-unmount="false"
              :finished-hold-ms="0"
              :initial-terminal-session-id="tab.terminalSessionId || ''"
              :reuse-running="false"
              :show-interrupt="false"
              :show-expanded-toggle="false"
              terminal-kind="shell"
              :session="tab.session"
              :shell-target="tab.target"
              :start-request-key="tab.startKey"
              :title="tab.title"
              @closed="closeShellTab(tab.id)"
              @expanded-changed="handleShellPanelExpandedChanged(tab.id, $event)"
              @finished="requestCloseShellTab(tab.id)"
              @running-changed="handleRunningChanged(tab.id, $event)"
              @started="handleShellStarted(tab.id, $event)"
            >
              <template #heading>
                <div
                  v-if="tab.id === activeShellTabId"
                  class="vibe64-shell-controls__tabs"
                  :title="shellTabsShortcutTitle"
                >
                  <div
                    class="vibe64-shell-controls__tab-list"
                    role="tablist"
                    @pointerdown.stop
                  >
                    <button
                      v-for="(shellTab, index) in shellTabs"
                      :key="shellTab.id"
                      type="button"
                      class="vibe64-shell-controls__tab"
                      :class="{
                        'vibe64-shell-controls__tab--active': shellTab.id === activeShellTabId
                      }"
                      :aria-selected="shellTab.id === activeShellTabId ? 'true' : 'false'"
                      role="tab"
                      :title="`Alt-${index + 1}: ${shellTab.label}`"
                      @pointerdown.prevent="selectShellTab(shellTab.id)"
                      @click="selectShellTab(shellTab.id)"
                    >
                      <span>{{ shellTab.label }}</span>
                      <v-icon
                        v-if="shellTab.running"
                        class="vibe64-shell-controls__tab-running"
                        :icon="mdiCircleSmall"
                        :size="embedded ? 22 : 18"
                      />
                      <v-icon
                        :icon="mdiClose"
                        class="vibe64-shell-controls__tab-close"
                        :size="embedded ? 20 : 15"
                        title="Close tab"
                        @pointerdown.stop
                        @click.stop="requestCloseShellTab(shellTab.id)"
                      />
                    </button>
                  </div>

                  <v-menu location="top end">
                    <template #activator="{ props: newTabMenuProps }">
                      <v-btn
                        v-bind="newTabMenuProps"
                        class="vibe64-shell-controls__new-tab"
                        :disabled="!canOpenAnyNewTab"
                        :icon="mdiPlus"
                        size="small"
                        :title="newShellTabTitle"
                        variant="text"
                        @pointerdown.stop
                      />
                    </template>

                    <v-list class="vibe64-shell-controls__menu" density="compact">
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
                </div>
              </template>
            </Vibe64CommandTerminal>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";
import { usePaths } from "@jskit-ai/users-web/client/composables/usePaths";
import {
  mdiCircleSmall,
  mdiClose,
  mdiFolderOutline,
  mdiMonitor,
  mdiMonitorDashboard,
  mdiPlus,
  mdiSourceRepository
} from "@mdi/js";
import Vibe64CommandTerminal from "@/components/studio/Vibe64CommandTerminal.vue";
import {
  useVibe64ProjectSlug
} from "@/composables/useVibe64ProjectScope.js";
import {
  VIBE64_SESSIONS_API_SUFFIX,
  VIBE64_SURFACE_ID,
  vibe64ShellTerminalPath
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  vibe64SessionWorktreePath
} from "@/lib/vibe64SessionPaths.js";
import {
  vibe64ShellPanelTargetSelector
} from "@/lib/vibe64ShellPanelTarget.js";
import {
  consumeShellShortcutEvent,
  MAX_SHELL_TABS,
  shellShortcutAction
} from "@/lib/vibe64ShellShortcuts.js";

const props = defineProps({
  embedded: {
    type: Boolean,
    default: false
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
const lastShellTarget = ref("");
const shellTabs = ref([]);
const shellPanelCollapsed = ref(false);
const shellPanelFrame = ref(null);
const shellTerminalRefs = new Map();
let shellTabSequence = 0;
let shortcutListenerActive = false;
let shellPanelResizeObserver = null;

const paths = usePaths();
const projectSlug = useVibe64ProjectSlug();
const sessionId = computed(() => String(props.session?.sessionId || ""));
const sessionsApiPath = computed(() => paths.api(VIBE64_SESSIONS_API_SUFFIX, {
  surface: VIBE64_SURFACE_ID
}));
const worktreePath = computed(() => vibe64SessionWorktreePath(props.session || {}));
const menuDisabled = computed(() => !sessionId.value);
const canOpenMainShell = computed(() => Boolean(sessionId.value && !menuDisabled.value));
const canOpenWorktreeShell = computed(() => Boolean(canOpenMainShell.value && worktreePath.value));
const hasShellTabs = computed(() => shellTabs.value.length > 0);
const shellPanelAllowed = computed(() => props.windowDisplayed !== false);
const shellTerminalListEnabled = computed(() => Boolean(sessionId.value && shellPanelAllowed.value));
const shellTerminalsPath = computed(() => (
  sessionId.value ? vibe64ShellTerminalPath(sessionsApiPath.value, sessionId.value) : ""
));
const shellPanelOpen = computed(() => Boolean(
  hasShellTabs.value &&
  shellPanelAllowed.value &&
  (
    props.embedded ||
    !shellPanelCollapsed.value
  )
));
const shellShortcutsActive = computed(() => shellPanelOpen.value);
const activeShellTab = computed(() => shellTabs.value.find((tab) => tab.id === activeShellTabId.value) || null);
const shellTabLimitReached = computed(() => shellTabs.value.length >= MAX_SHELL_TABS);
const shellTabLimitMessage = `Shell tabs are limited to ${MAX_SHELL_TABS}.`;
const canCreateMainShell = computed(() => Boolean(!shellTabLimitReached.value && canOpenMainShell.value));
const canCreateWorktreeShell = computed(() => Boolean(!shellTabLimitReached.value && canOpenWorktreeShell.value));
const canOpenNewTab = computed(() => {
  return targetCanOpen(defaultNewTabTarget());
});
const canOpenAnyNewTab = computed(() => canCreateWorktreeShell.value || canCreateMainShell.value);
const mainShellMenuSubtitle = computed(() => (shellTabLimitReached.value ? shellTabLimitMessage : "Project root"));
const newShellTabTitle = computed(() => (
  shellTabLimitReached.value ? shellTabLimitMessage : "New shell tab (Alt-N opens the last shell type)"
));
const shellTabsShortcutTitle = `Alt-N creates a tab. Alt-1 through Alt-${MAX_SHELL_TABS} switches tabs.`;
const shellPanelTargetSelector = computed(() => vibe64ShellPanelTargetSelector(sessionId.value));
const shellTerminalsResource = useEndpointResource({
  enabled: shellTerminalListEnabled,
  fallbackLoadError: "Shell terminals could not be loaded.",
  path: shellTerminalsPath,
  queryKey: computed(() => [
    "vibe64",
    projectSlug.value,
    VIBE64_SURFACE_ID,
    ROUTE_VISIBILITY_PUBLIC,
    "shell-terminals",
    sessionId.value
  ]),
  requestRecovery: false,
  realtime: null
});
const runningShellCount = computed(() => shellTabs.value.filter((tab) => tab.running).length);
const shellActivatorIcon = computed(() => (runningShellCount.value > 0 ? mdiMonitorDashboard : mdiMonitor));
const shellActivatorColor = computed(() => (hasShellTabs.value ? "primary" : undefined));
const shellActivatorTitle = computed(() => {
  if (!hasShellTabs.value) {
    return "Open shell";
  }
  return shellPanelOpen.value ? "Hide shells" : "Show shells";
});
const shellPanelStyle = computed(() => {
  if (props.embedded) {
    return {};
  }
  const frame = shellPanelFrame.value;
  if (!shellPanelOpen.value || !frame) {
    return {};
  }
  return {
    bottom: `${frame.bottom}px`,
    height: "auto",
    left: "0px",
    top: `${frame.top}px`,
    width: `${frame.right}px`
  };
});
const showShellTargetMenu = computed(() => Boolean(props.showActivator && !hasShellTabs.value));
const worktreeShellMenuSubtitle = computed(() => {
  if (shellTabLimitReached.value) {
    return shellTabLimitMessage;
  }
  return worktreePath.value || "Create the session worktree first.";
});

function shellTargetTitle(target = "") {
  return target === "main" ? "Repo shell" : "Worktree shell";
}

function shellTargetLabel(target = "") {
  return target === "main" ? "repo" : "worktree";
}

function nextShellTabLabel(target = "") {
  const normalizedTarget = target === "main" ? "main" : "worktree";
  return shellTargetLabel(normalizedTarget);
}

function normalizeShellTarget(target = "") {
  return target === "main" ? "main" : "worktree";
}

function newShellTabId(target = "") {
  shellTabSequence += 1;
  return `${sessionId.value}:shell:${target}:${Date.now()}:${shellTabSequence}`;
}

function restoredShellTabId(terminalSessionId = "") {
  return `${sessionId.value}:shell:${terminalSessionId}`;
}

function defaultNewTabTarget() {
  if (lastShellTarget.value && targetCanOpen(lastShellTarget.value)) {
    return lastShellTarget.value;
  }
  if (activeShellTab.value?.target && targetCanOpen(activeShellTab.value.target)) {
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

function toggleShellPanel() {
  if (!hasShellTabs.value) {
    return;
  }
  shellPanelCollapsed.value = !shellPanelCollapsed.value;
  if (!shellPanelCollapsed.value) {
    void focusShellTab();
  }
}

function createShellTab(target) {
  if (!targetCanOpen(target)) {
    return;
  }
  const tabLabel = nextShellTabLabel(target);
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
      terminalSessionId: "",
      title: shellTargetTitle(target)
    }
  ];
  lastShellTarget.value = target;
  activeShellTabId.value = tabId;
  shellPanelCollapsed.value = false;
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
  shellPanelCollapsed.value = false;
  void focusShellTab(tabId);
}

function closeShell() {
  shellTabs.value = [];
  activeShellTabId.value = "";
  lastShellTarget.value = "";
  shellPanelCollapsed.value = false;
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
    shellPanelCollapsed.value = false;
    return;
  }
  void focusShellTab(fallbackTab.id);
}

function requestCloseShellTab(tabId = "") {
  const terminalComponent = shellTerminalRefs.get(tabId);
  if (terminalComponent && typeof terminalComponent.close === "function") {
    void terminalComponent.close();
    return;
  }
  closeShellTab(tabId);
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

function focusShellTab(tabId = activeShellTabId.value) {
  const selectedTabId = String(tabId || "");
  if (!selectedTabId) {
    return;
  }

  shellTerminalRefs.get(selectedTabId)?.focus?.();
  void nextTick().then(() => {
    shellTerminalRefs.get(selectedTabId)?.focus?.();
    const focusAfterPaint = () => {
      shellTerminalRefs.get(selectedTabId)?.focus?.();
    };
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(focusAfterPaint);
      return;
    }
    if (typeof window !== "undefined") {
      window.setTimeout(focusAfterPaint, 0);
    }
  });
}

function handleShellStarted(tabId = "", event = {}) {
  const tab = shellTabs.value.find((item) => item.id === tabId);
  if (tab) {
    tab.terminalSessionId = String(event?.terminalSessionId || tab.terminalSessionId || "");
  }
  focusShellTab(tabId);
}

function handleRunningChanged(tabId = "", nextRunning = false) {
  const tab = shellTabs.value.find((item) => item.id === tabId);
  if (tab) {
    tab.running = Boolean(nextRunning);
  }
}

function shellTerminalsFromPayload(payload = {}) {
  return Array.isArray(payload?.terminals) ? payload.terminals : [];
}

function shellTerminalBelongsToSession(terminal = {}) {
  const metadataSessionId = String(terminal?.metadata?.sessionId || "").trim();
  return !metadataSessionId || metadataSessionId === sessionId.value;
}

function shellTabFromTerminal(terminal = {}) {
  const terminalSessionId = String(terminal.id || terminal.terminalSessionId || "").trim();
  const target = normalizeShellTarget(terminal.metadata?.target || "");
  const tabId = restoredShellTabId(terminalSessionId);
  return {
    id: tabId,
    label: nextShellTabLabel(target),
    running: terminal.status === "running" || terminal.status === "closing",
    session: props.session,
    startKey: `${tabId}:attach`,
    target,
    terminalSessionId,
    title: shellTargetTitle(target)
  };
}

function restoreShellTerminalTabs(payload = {}) {
  if (!sessionId.value) {
    return;
  }
  const terminals = shellTerminalsFromPayload(payload).filter((terminal) => {
    const terminalSessionId = String(terminal.id || terminal.terminalSessionId || "").trim();
    return Boolean(terminalSessionId && shellTerminalBelongsToSession(terminal));
  });
  if (!terminals.length) {
    return;
  }

  const existingTerminalIds = new Set(shellTabs.value
    .map((tab) => String(tab.terminalSessionId || "").trim())
    .filter(Boolean));
  const restoredTabs = terminals
    .filter((terminal) => !existingTerminalIds.has(String(terminal.id || terminal.terminalSessionId || "").trim()))
    .map(shellTabFromTerminal);
  if (!restoredTabs.length) {
    return;
  }

  shellTabs.value = [
    ...shellTabs.value,
    ...restoredTabs
  ];
  if (!activeShellTabId.value) {
    activeShellTabId.value = restoredTabs[0].id;
  }
}

function handleShellPanelExpandedChanged(tabId = "", expanded = true) {
  if (props.embedded) {
    return;
  }
  if (tabId !== activeShellTabId.value) {
    return;
  }
  shellPanelCollapsed.value = expanded !== true;
  if (shellPanelCollapsed.value && typeof document !== "undefined") {
    document.activeElement?.blur?.();
  }
}

function handleShellShortcut(event) {
  if (!hasShellTabs.value || event.defaultPrevented) {
    return;
  }

  const shortcut = shellShortcutAction(event);
  if (!shortcut) {
    return;
  }
  if (shortcut.type === "new-tab") {
    if (!canOpenNewTab.value) {
      return;
    }
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

function visibleShellPanelTarget() {
  if (props.embedded) {
    return null;
  }
  if (typeof document === "undefined") {
    return null;
  }
  const target = document.querySelector(shellPanelTargetSelector.value);
  const rect = target?.getBoundingClientRect?.();
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    return null;
  }
  return target;
}

function syncShellPanelFrame() {
  const target = visibleShellPanelTarget();
  const rect = target?.getBoundingClientRect?.();
  if (!rect) {
    shellPanelFrame.value = null;
    return;
  }
  const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || rect.bottom;
  shellPanelFrame.value = {
    bottom: Math.max(0, viewportHeight - rect.bottom),
    right: Math.round(rect.right),
    top: rect.top
  };
}

async function startShellPanelFrameTracking() {
  stopShellPanelFrameTracking();
  if (props.embedded) {
    return;
  }
  await nextTick();
  syncShellPanelFrame();

  const target = visibleShellPanelTarget();
  if (typeof ResizeObserver === "function" && target) {
    shellPanelResizeObserver = new ResizeObserver(syncShellPanelFrame);
    shellPanelResizeObserver.observe(target);
  }

  if (typeof window !== "undefined") {
    window.addEventListener("resize", syncShellPanelFrame, true);
    window.addEventListener("scroll", syncShellPanelFrame, true);
  }
}

function stopShellPanelFrameTracking() {
  shellPanelResizeObserver?.disconnect?.();
  shellPanelResizeObserver = null;
  if (typeof window !== "undefined") {
    window.removeEventListener("resize", syncShellPanelFrame, true);
    window.removeEventListener("scroll", syncShellPanelFrame, true);
  }
  shellPanelFrame.value = null;
}

watch(sessionId, () => {
  closeShell();
});

watch(() => shellTerminalsResource.data.value, (payload) => {
  restoreShellTerminalTabs(payload);
}, {
  immediate: true
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

watch(shellPanelOpen, (open) => {
  if (open) {
    void startShellPanelFrameTracking();
  } else {
    stopShellPanelFrameTracking();
  }
}, {
  immediate: true
});

onBeforeUnmount(() => {
  stopShellShortcuts();
  stopShellPanelFrameTracking();
});
</script>

<style scoped>
.vibe64-shell-controls {
  align-items: center;
  display: inline-flex;
  min-width: 0;
}

.vibe64-shell-controls--embedded {
  align-items: stretch;
  display: grid;
  height: 100%;
  min-height: 0;
  width: 100%;
}

.vibe64-shell-controls__empty {
  align-content: center;
  display: grid;
  gap: 0.9rem;
  justify-items: center;
  min-height: 0;
  padding: 1rem;
  text-align: center;
}

.vibe64-shell-controls__empty p {
  color: rgba(var(--v-theme-on-surface), 0.68);
  margin: 0;
}

.vibe64-shell-controls__empty-actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem;
  justify-content: center;
}

.vibe64-shell-controls__empty-action {
  min-height: 2.75rem;
  padding-inline: 1.15rem;
}

.vibe64-shell-controls__menu {
  max-width: min(22rem, 92vw);
  min-width: min(18rem, 92vw);
}

.vibe64-shell-controls__window {
  display: flex;
  flex-direction: column;
  gap: 0;
  height: 100%;
  min-height: 0;
}

.vibe64-shell-controls__inline-panel {
  background: rgb(var(--v-theme-surface));
  height: 100%;
  min-height: 0;
  min-width: 0;
  pointer-events: auto;
}

.vibe64-shell-controls__inline-panel--displayed {
  position: fixed;
  z-index: 2600;
}

.vibe64-shell-controls__inline-panel--embedded.vibe64-shell-controls__inline-panel--displayed {
  position: relative;
  z-index: auto;
}

.vibe64-shell-controls__inline-panel--hidden {
  height: 0;
  overflow: hidden;
  pointer-events: none;
  position: absolute;
  visibility: hidden;
  width: 0;
}

.vibe64-shell-controls__tabs {
  align-items: center;
  cursor: default;
  display: flex;
  gap: 0.3rem;
  min-height: 1.9rem;
  min-width: 0;
  user-select: none;
  width: 100%;
}

.vibe64-shell-controls--embedded .vibe64-shell-controls__tabs {
  align-items: stretch;
  gap: 0.2rem;
  min-height: 48px;
}

.vibe64-shell-controls__tab-list {
  cursor: default;
  display: flex;
  flex: 1 1 auto;
  gap: 0.25rem;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.vibe64-shell-controls__tab-list::-webkit-scrollbar {
  display: none;
}

.vibe64-shell-controls--embedded .vibe64-shell-controls__tab-list {
  align-items: stretch;
}

.vibe64-shell-controls__new-tab {
  flex: 0 0 auto;
}

.vibe64-shell-controls--embedded .vibe64-shell-controls__new-tab {
  height: 48px;
  min-height: 48px;
  min-width: 48px;
  width: 48px;
}

.vibe64-shell-controls__tab {
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

.vibe64-shell-controls--embedded .vibe64-shell-controls__tab {
  border-radius: 6px 6px 0 0;
  flex-basis: 6rem;
  font-size: 0.92rem;
  height: 48px;
  max-width: 9rem;
  min-height: 48px;
  min-width: 5.6rem;
  padding: 0.22rem 0.42rem 0.22rem 0.66rem;
}

.vibe64-shell-controls__tab:hover,
.vibe64-shell-controls__tab--active {
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-on-surface));
}

.vibe64-shell-controls__tab span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vibe64-shell-controls__tab-running {
  color: rgb(var(--v-theme-success));
  flex: 0 0 auto;
}

.vibe64-shell-controls__tab-close {
  border-radius: 999px;
  flex: 0 0 auto;
  opacity: 0.62;
}

.vibe64-shell-controls__tab-close:hover {
  background: rgba(var(--v-theme-on-surface), 0.12);
  opacity: 1;
}

.vibe64-shell-controls--embedded .vibe64-shell-controls__tab-running {
  height: 1.35rem;
  width: 1.35rem;
}

.vibe64-shell-controls--embedded .vibe64-shell-controls__tab-close {
  height: 1.2rem;
  width: 1.2rem;
}

.vibe64-shell-controls__terminal-stack {
  flex: 1 1 auto;
  min-height: 0;
  position: relative;
}

.vibe64-shell-controls__terminal {
  height: 100%;
  inset: 0;
  pointer-events: none;
  position: absolute;
  visibility: hidden;
  width: 100%;
}

.vibe64-shell-controls__terminal--active {
  pointer-events: auto;
  visibility: visible;
}

.vibe64-shell-controls__inline-panel :deep(.ai-command-terminal) {
  box-shadow: none;
  height: 100%;
}

.vibe64-shell-controls__inline-panel :deep(.ai-command-terminal__body) {
  flex: 1 1 auto;
  grid-template-rows: auto minmax(0, 1fr) auto;
  height: auto;
  min-height: 0;
  overflow: hidden;
}

.vibe64-shell-controls__inline-panel :deep(.ai-command-terminal--shell .ai-command-terminal__body) {
  display: flex;
  flex-direction: column;
  gap: 0.24rem;
}

.vibe64-shell-controls__inline-panel :deep(.ai-command-terminal--shell .ai-command-terminal__stage) {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
}

.vibe64-shell-controls--embedded .vibe64-shell-controls__inline-panel :deep(.ai-command-terminal--shell) {
  padding-top: 0.12rem;
}

.vibe64-shell-controls--embedded .vibe64-shell-controls__inline-panel :deep(.ai-command-terminal--shell .ai-command-terminal__bar) {
  align-items: flex-end;
  margin-bottom: 0;
  margin-top: calc(30px + 0.1rem);
}

.vibe64-shell-controls--embedded .vibe64-shell-controls__inline-panel :deep(.ai-command-terminal--shell .ai-command-terminal__actions .v-btn) {
  height: 48px;
  min-height: 48px;
  min-width: 48px;
}

.vibe64-shell-controls--embedded .vibe64-shell-controls__inline-panel :deep(.ai-command-terminal--shell .ai-command-terminal__actions .v-btn--icon) {
  height: 48px;
  width: 48px;
}

.vibe64-shell-controls__inline-panel :deep(.ai-command-terminal__host) {
  height: 100%;
  min-height: 0;
}

.vibe64-shell-controls--embedded .vibe64-shell-controls__inline-panel :deep(.ai-command-terminal__host) {
  height: 100%;
  margin-top: 0;
}

@media (max-width: 980px) {
  .vibe64-shell-controls__inline-panel--displayed {
    background: rgb(var(--v-theme-background));
    height: auto !important;
    inset: 0;
    left: 0 !important;
    padding: 0.65rem;
    top: 0 !important;
    width: auto !important;
    z-index: 2500;
  }
}
</style>
