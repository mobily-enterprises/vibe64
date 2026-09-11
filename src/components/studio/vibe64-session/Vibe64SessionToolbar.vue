<template>
  <div
    class="studio-ai-sessions__toolbar"
    :class="{ 'studio-ai-sessions__toolbar--compact': compact }"
  >
    <div class="studio-ai-sessions__tabs">
      <v-chip
        v-for="sessionItem in visibleSessions"
        :key="sessionItem.sessionId"
        class="studio-ai-sessions__tab"
        :class="{
          'studio-ai-sessions__tab--active': sessionItem.sessionId === selectedSessionId,
          'studio-ai-sessions__tab--thinking': !sessionItem.archiving && sessionItem.agentThinking,
          'studio-ai-sessions__tab--archiving': sessionItem.archiving
        }"
        :size="compact ? 'small' : 'large'"
        :aria-label="sessionTabAriaLabel(sessionItem)"
        :disabled="sessionItem.archiving"
        :data-vibe64-session-id="sessionItem.sessionId"
        variant="flat"
        @click="selectSession(sessionItem.sessionId)"
        @focusin="active && $event.target.matches(':focus-visible') && sessionTooltip.resumeHover()"
      >
        <span class="studio-ai-sessions__tab-main">
          <span
            class="studio-ai-sessions__status-dot"
            :class="`studio-ai-sessions__status-dot--${sessionItem.status}`"
          />
          <span class="studio-ai-sessions__tab-label">{{ sessionItem.archiving ? `${sessionTabLabel(sessionItem)} · Archiving…` : sessionTabLabel(sessionItem) }}</span>
          <v-icon
            class="studio-ai-sessions__repository-state studio-ai-sessions__repository-state--desktop"
            :class="`studio-ai-sessions__repository-state--${repositoryState(sessionItem)}`"
            :icon="repositoryStateIcon(sessionItem)"
            size="14"
            :title="repositoryStateLabel(sessionItem)"
          />
          <v-btn
            class="studio-ai-sessions__tab-info"
            :aria-label="`Session info: ${sessionTabLabel(sessionItem)}`"
            :aria-expanded="infoSessionId === sessionItem.sessionId"
            :aria-describedby="`${infoId}-${sessionItem.sessionId}`"
            :icon="mdiInformationOutline"
            size="x-small"
            variant="text"
            @click.stop="setSessionInfo(sessionItem.sessionId, infoSessionId !== sessionItem.sessionId)"
          />
        </span>
        <span
          v-if="sessionItem.sessionId === selectedSessionId"
          class="studio-ai-sessions__tab-close-slot"
        >
          <v-btn
            class="studio-ai-sessions__tab-archive"
            density="comfortable"
            :disabled="selectionArchived || archive.command.isRunning"
            :icon="mdiArchiveOutline"
            size="small"
            title="Archive session"
            variant="text"
            aria-label="Archive session"
            @click.stop="archive.request"
          />
        </span>
        <v-tooltip
          :id="`${infoId}-${sessionItem.sessionId}`"
          activator="parent"
          :model-value="infoSessionId === sessionItem.sessionId"
          :disabled="!active"
          :open-delay="1000"
          :close-delay="150"
          :open-on-click="false"
          open-on-focus
          interactive
          color="surface-variant"
          location="bottom"
          :max-width="320"
          @update:model-value="(!$event || sessionTooltip.suppressedSessionId.value !== sessionItem.sessionId) && setSessionInfo(sessionItem.sessionId, $event)"
        >
          <div class="studio-ai-sessions__info">
            <strong>{{ sessionTabLabel(sessionItem) }}</strong>
            <dl class="studio-ai-sessions__info-facts">
              <template v-for="fact in sessionInfoFacts(sessionItem)" :key="fact.key">
                <dt>{{ fact.label }}</dt>
                <dd>{{ fact.value }}</dd>
              </template>
            </dl>
          </div>
        </v-tooltip>
      </v-chip>

      <Vibe64CreateSessionButton
        v-if="createVisible && (sessionLimit < 1 || allSessions.length < sessionLimit)"
        aria-label="New session"
        :button-class="createSessionButtonClass"
        icon-only
        :toolbar="toolbar"
      />

      <slot name="after-sessions" />
    </div>
  </div>
</template>

<script setup>
import { computed, inject, ref, useId, watch } from "vue";
import {
  mdiAlertCircleOutline,
  mdiArchiveOutline,
  mdiCheckCircleOutline,
  mdiCloudDownloadOutline,
  mdiContentSaveAlertOutline,
  mdiDotsHorizontalCircleOutline,
  mdiInformationOutline
} from "@mdi/js";
import { VIBE64_AGENT_PROVIDERS } from "@local/vibe64-runtime/shared";
import Vibe64CreateSessionButton from "@/components/studio/vibe64-session/Vibe64CreateSessionButton.vue";
import { vibe64SessionInfoFacts } from "@/lib/vibe64SessionInfo.js";
import { vibe64SessionStatusLabel } from "@/lib/vibe64SessionViewModel.js";
import { VIBE64_SESSION_TOOLTIP_KEY } from "@/lib/vibe64SessionTooltip.js";
import {
  visibleVibe64ToolbarSessions
} from "@/lib/vibe64SessionToolbarVisibility.js";

const props = defineProps({
  active: {
    default: true,
    type: Boolean
  },
  archive: {
    default: () => ({}),
    type: Object
  },
  selectedSessionId: {
    default: "",
    type: String
  },
  selectionArchived: {
    default: false,
    type: Boolean
  },
  toolbar: {
    default: () => ({}),
    type: Object
  },
  compact: {
    default: false,
    type: Boolean
  },
  createAttention: {
    default: false,
    type: Boolean
  },
  createVisible: {
    default: true,
    type: Boolean
  },
  maxVisibleSessions: {
    default: 3,
    type: Number
  }
});

const emit = defineEmits(["select-session"]);
const infoSessionId = ref("");
const sessionTooltip = inject(VIBE64_SESSION_TOOLTIP_KEY);
const infoId = useId();
const createdAtFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short"
});

function setSessionInfo(sessionId, visible) {
  if (visible && !props.active) return;
  if (visible || infoSessionId.value === sessionId) {
    infoSessionId.value = visible ? sessionId : "";
  }
}

watch(() => props.active, (active) => {
  if (!active) infoSessionId.value = "";
}, { flush: "sync" });

function sessionInfoFacts(sessionItem) {
  const selection = sessionItem.assistantSelection || {};
  const assistant = VIBE64_AGENT_PROVIDERS.find((provider) => provider.id === selection.engineId);
  const details = vibe64SessionInfoFacts(sessionItem)
    .filter((fact) => ["session", "branch", "created-at"].includes(fact.key))
    .map((fact) => {
      const createdAt = fact.key === "created-at" ? Date.parse(fact.value) : NaN;
      return {
        ...fact,
        value: Number.isFinite(createdAt) ? createdAtFormatter.format(createdAt) : fact.copyValue
      };
    });
  return [
    {
      key: "status",
      label: "Status",
      value: sessionItem.agentThinking ? "Working" : vibe64SessionStatusLabel(sessionItem.status)
    },
    {
      key: "assistant",
      label: "Assistant",
      value: assistant?.label || selection.engineId
    },
    { key: "model", label: "Model", value: selection.modelId },
    { key: "saved-work", label: "Work", value: repositoryStateLabel(sessionItem) },
    ...details
  ].filter((fact) => fact.value);
}

function selectSession(sessionId = "") {
  sessionTooltip.suppressedSessionId.value = sessionId;
  infoSessionId.value = "";
  emit("select-session", sessionId);
  props.toolbar.selectSession?.(sessionId);
}

function sessionTabLabel(sessionItem = {}) {
  const sessionName = String(sessionItem.sessionName || sessionItem.metadata?.issue_word || "").trim();
  if (sessionName) {
    return sessionName;
  }
  return props.toolbar.shortSessionId?.(sessionItem.sessionId) || String(sessionItem.sessionId || "");
}

function repositoryState(sessionItem = {}) {
  const state = String(sessionItem?.repositoryWorkState?.state || "checking");
  return [
    "needs_help",
    "saved",
    "saving",
    "unavailable",
    "unsaved",
    "update_available",
    "updating"
  ].includes(state) ? state : "checking";
}

function repositoryStateLabel(sessionItem = {}) {
  const state = repositoryState(sessionItem);
  if (state === "unsaved") {
    const changedCount = Number(sessionItem?.repositoryWorkState?.changedCount || 0);
    const changeLabel = changedCount === 1 ? "1 change" : `${changedCount || "Unsaved"} changes`;
    return sessionItem?.repositoryWorkState?.updateAvailable
      ? `${changeLabel}; update available`
      : changeLabel;
  }
  return ({
    checking: "Checking whether work is saved",
    needs_help: "Repository needs help",
    saved: "All work is saved",
    saving: "Saving work",
    unavailable: "Save status is unavailable",
    update_available: "Update available",
    updating: "Updating session"
  })[state];
}

function repositoryStateIcon(sessionItem = {}) {
  return ({
    checking: mdiDotsHorizontalCircleOutline,
    needs_help: mdiAlertCircleOutline,
    saved: mdiCheckCircleOutline,
    saving: mdiDotsHorizontalCircleOutline,
    unavailable: mdiAlertCircleOutline,
    unsaved: mdiContentSaveAlertOutline,
    update_available: mdiCloudDownloadOutline,
    updating: mdiDotsHorizontalCircleOutline
  })[repositoryState(sessionItem)];
}

function sessionTabAriaLabel(sessionItem = {}) {
  if (sessionItem.archiving) {
    return `${sessionTabLabel(sessionItem)}. Inactive. Archiving session.`;
  }
  return `${sessionTabLabel(sessionItem)}. ${repositoryStateLabel(sessionItem)}.`;
}

const allSessions = computed(() => Array.isArray(props.toolbar.sessions) ? props.toolbar.sessions : []);
const sessionLimit = computed(() => Math.max(0, Number(props.maxVisibleSessions || 0)));
const createSessionButtonClass = computed(() => [
  "studio-ai-sessions__create-button",
  {
    "studio-ai-sessions__create-button--attention": props.createAttention
  }
]);
const visibleSessions = computed(() => {
  return visibleVibe64ToolbarSessions({
    limit: sessionLimit.value,
    selectedSessionId: props.selectedSessionId,
    sessions: allSessions.value
  });
});
</script>

<style scoped>
.studio-ai-sessions__toolbar {
  align-items: center;
  display: flex;
  gap: 0.75rem;
  justify-content: flex-start;
  min-width: 0;
  width: 100%;
}

.studio-ai-sessions__tabs {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  min-width: 0;
  width: 100%;
}

.studio-ai-sessions__tab {
  align-items: stretch;
  background: transparent !important;
  border: 0;
  border-radius: 999px;
  box-shadow: none !important;
  color: var(--studio-control-text, #202124) !important;
  font-weight: 500;
  max-width: 18rem;
  overflow: visible;
  padding: 0 !important;
  position: relative;
}

.studio-ai-sessions__tab :deep(.v-chip__content) {
  align-items: stretch;
  display: inline-flex;
  min-width: 0;
}

.studio-ai-sessions__tab-main {
  align-items: center;
  background: var(--studio-control-rest-bg, #f7f7f8);
  border: 1px solid transparent;
  border-radius: 999px;
  box-sizing: border-box;
  color: var(--studio-control-text, #202124);
  display: inline-flex;
  flex: 1 1 auto;
  min-width: 0;
  padding-inline: 0.85rem;
}

.studio-ai-sessions__tab--active {
  color: var(--studio-control-text, #202124) !important;
  font-weight: 560;
}

.studio-ai-sessions__tab--archiving .studio-ai-sessions__tab-main {
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.55);
}

.studio-ai-sessions__tab--archiving .studio-ai-sessions__status-dot {
  background: currentColor;
}

.studio-ai-sessions__tab--active .studio-ai-sessions__tab-main {
  background: var(--studio-control-active-bg, #e7e7e7);
  border-radius: 999px 0 0 999px;
  padding-inline-end: 0.34rem;
}

.studio-ai-sessions__tab-main:hover,
.studio-ai-sessions__tab:focus-visible .studio-ai-sessions__tab-main {
  background: rgb(var(--v-theme-primary));
  border-color: transparent;
  color: rgb(var(--v-theme-on-primary));
}

.studio-ai-sessions__tab-main:hover + .studio-ai-sessions__tab-close-slot,
.studio-ai-sessions__tab:focus-visible .studio-ai-sessions__tab-close-slot {
  background: rgb(var(--v-theme-primary));
  border-color: transparent;
  color: rgb(var(--v-theme-on-primary));
}

.studio-ai-sessions__tab :deep(.v-chip__overlay),
.studio-ai-sessions__tab :deep(.v-chip__underlay) {
  display: none;
}

.studio-ai-sessions__tab-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.studio-ai-sessions__repository-state {
  color: rgba(var(--v-theme-on-surface), 0.52);
  flex: 0 0 auto;
  margin-inline-start: 0.42rem;
}

.studio-ai-sessions__tab-info {
  color: inherit;
  display: none;
  flex-shrink: 0;
}

.studio-ai-sessions__info {
  max-width: 100%;
  overflow-wrap: anywhere;
  padding: 0.25rem;
}

.studio-ai-sessions__info-facts {
  display: grid;
  gap: 0.3rem 0.75rem;
  grid-template-columns: auto minmax(0, 1fr);
  margin: 0.5rem 0 0;
}

.studio-ai-sessions__info-facts dt {
  opacity: 0.75;
}

.studio-ai-sessions__info-facts dd {
  margin: 0;
}

.studio-ai-sessions__repository-state--saved {
  color: rgb(var(--v-theme-success));
}

.studio-ai-sessions__repository-state--unsaved,
.studio-ai-sessions__repository-state--unavailable {
  color: rgb(var(--v-theme-error));
}

.studio-ai-sessions__tab-close-slot {
  align-items: center;
  background: var(--studio-control-active-bg, #e7e7e7);
  border: 1px solid transparent;
  border-left: 0;
  border-radius: 0 999px 999px 0;
  box-sizing: border-box;
  color: rgba(var(--v-theme-on-surface), 0.68);
  display: inline-flex;
  flex: 0 0 auto;
  justify-content: center;
  padding-inline: 0.14rem 0.28rem;
}

.studio-ai-sessions__tab-archive {
  background: transparent !important;
  color: currentColor !important;
  flex: 0 0 1.38rem;
  height: 1.38rem !important;
  min-height: 1.38rem;
  min-width: 1.38rem;
  padding: 0 !important;
  width: 1.38rem !important;
}

.studio-ai-sessions__tab-archive:hover,
.studio-ai-sessions__tab-archive:focus-visible {
  background: rgb(var(--v-theme-primary)) !important;
  box-shadow:
    inset 0 0 0 1px rgba(var(--v-theme-on-primary), 0.16),
    0 1px 3px rgba(var(--v-theme-primary), 0.34);
  color: rgb(var(--v-theme-on-primary)) !important;
  opacity: 1;
  pointer-events: auto;
}

.studio-ai-sessions__tab-archive :deep(.v-icon) {
  font-size: 0.98rem;
}

.studio-ai-sessions__tab-main:hover .studio-ai-sessions__status-dot,
.studio-ai-sessions__tab:focus-visible .studio-ai-sessions__status-dot {
  background: currentColor;
}

.studio-ai-sessions__status-dot {
  background: rgb(var(--v-theme-primary));
  border-radius: 999px;
  contain: paint;
  display: inline-block;
  flex: 0 0 auto;
  height: 0.52rem;
  margin-right: 0.42rem;
  position: relative;
  width: 0.52rem;
}

.studio-ai-sessions__tab--thinking .studio-ai-sessions__status-dot {
  animation: studio-ai-sessions-thinking-pulse 1.3s steps(2, end) infinite;
}

.studio-ai-sessions__status-dot--blocked,
.studio-ai-sessions__status-dot--failed {
  background: rgb(var(--v-theme-error));
}

@keyframes studio-ai-sessions-thinking-pulse {
  0%,
  100% {
    opacity: 0.45;
  }

  50% {
    opacity: 1;
  }
}

.studio-ai-sessions__toolbar--compact .studio-ai-sessions__tabs {
  flex-wrap: nowrap;
  gap: 0.34rem;
}

.studio-ai-sessions__toolbar--compact {
  height: 2rem;
  min-height: 2rem;
}

.studio-ai-sessions__toolbar--compact .studio-ai-sessions__tab {
  flex: 1 1 0;
  font-size: 0.92rem;
  height: 2rem;
  letter-spacing: 0;
  max-width: 12.5rem;
  min-height: 2rem;
  min-width: 0;
}

.studio-ai-sessions__toolbar--compact .studio-ai-sessions__tab-main {
  padding-inline: 0.25rem;
}

.studio-ai-sessions__toolbar--compact .studio-ai-sessions__tab--active {
  flex-basis: 1.7rem;
}

.studio-ai-sessions__toolbar--compact .studio-ai-sessions__tab--active .studio-ai-sessions__tab-main {
  padding-inline-end: 0.28rem;
}

.studio-ai-sessions__toolbar--compact .studio-ai-sessions__tab-close-slot {
  padding-inline: 0.08rem 0.22rem;
}

.studio-ai-sessions__toolbar--compact .studio-ai-sessions__status-dot {
  height: 0.58rem;
  margin-right: 0.25rem;
  width: 0.58rem;
}

.studio-ai-sessions__toolbar--compact .studio-ai-sessions__repository-state {
  margin-inline-start: 0.25rem;
}

.studio-ai-sessions__toolbar--compact .studio-ai-sessions__tab-archive {
  flex-basis: 1.42rem;
  height: 1.42rem !important;
  min-height: 1.42rem;
  min-width: 1.42rem;
  width: 1.42rem !important;
}

.studio-ai-sessions__toolbar--compact .studio-ai-sessions__tab-archive :deep(.v-icon) {
  font-size: 1rem;
}

@media (max-width: 640px) {
  .studio-ai-sessions__toolbar {
    align-items: stretch;
    flex-direction: column;
  }
}

@media (hover: none), (pointer: coarse) {
  .studio-ai-sessions__tab-info {
    display: inline-flex;
  }

  .studio-ai-sessions__repository-state--desktop {
    display: none;
  }

  .studio-ai-sessions__tab .studio-ai-sessions__tab-archive {
    box-shadow: none;
    opacity: 1;
    pointer-events: auto;
  }
}

@media (prefers-reduced-motion: reduce) {
  .studio-ai-sessions__tab--thinking .studio-ai-sessions__status-dot {
    animation: none;
    opacity: 1;
  }
}

</style>
