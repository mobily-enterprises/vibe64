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
          'studio-ai-sessions__tab--thinking': sessionItem.agentThinking
        }"
        :size="compact ? 'small' : 'large'"
        variant="flat"
        @click="toolbar.selectSession(sessionItem.sessionId)"
      >
        <span class="studio-ai-sessions__tab-main">
          <span
            class="studio-ai-sessions__status-dot"
            :class="`studio-ai-sessions__status-dot--${sessionItem.status}`"
          />
          <span class="studio-ai-sessions__tab-label">{{ sessionTabLabel(sessionItem) }}</span>
        </span>
        <span
          v-if="sessionItem.sessionId === selectedSessionId"
          class="studio-ai-sessions__tab-close-slot"
        >
          <v-btn
            class="studio-ai-sessions__tab-abandon"
            density="comfortable"
            :disabled="selectionClosed || abandon.command.isRunning"
            :icon="mdiClose"
            :loading="abandon.command.isRunning"
            size="small"
            title="Abandon session"
            variant="text"
            aria-label="Abandon session"
            @click.stop="abandon.request"
          />
        </span>
      </v-chip>

      <Vibe64CreateSessionButton
        v-if="createVisible"
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
import { computed } from "vue";
import {
  mdiClose
} from "@mdi/js";
import Vibe64CreateSessionButton from "@/components/studio/vibe64-session/Vibe64CreateSessionButton.vue";

const props = defineProps({
  abandon: {
    default: () => ({}),
    type: Object
  },
  selectedSessionId: {
    default: "",
    type: String
  },
  selectionClosed: {
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

function sessionTabLabel(sessionItem = {}) {
  const sessionName = String(sessionItem.sessionName || sessionItem.metadata?.issue_word || "").trim();
  if (sessionName) {
    return sessionName;
  }
  return props.toolbar.shortSessionId?.(sessionItem.sessionId) || String(sessionItem.sessionId || "");
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
  const limit = sessionLimit.value;
  if (limit < 1 || allSessions.value.length <= limit) {
    return allSessions.value;
  }
  const selectedIndex = allSessions.value.findIndex((sessionItem) => sessionItem.sessionId === props.selectedSessionId);
  if (selectedIndex < 0 || selectedIndex < limit) {
    return allSessions.value.slice(0, limit);
  }
  return [
    ...allSessions.value.slice(0, Math.max(0, limit - 1)),
    allSessions.value[selectedIndex]
  ];
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

.studio-ai-sessions__tab-abandon {
  background: transparent !important;
  color: currentColor !important;
  flex: 0 0 1.38rem;
  height: 1.38rem !important;
  min-height: 1.38rem;
  min-width: 1.38rem;
  padding: 0 !important;
  width: 1.38rem !important;
}

.studio-ai-sessions__tab-abandon:hover,
.studio-ai-sessions__tab-abandon:focus-visible {
  background: rgb(var(--v-theme-primary)) !important;
  box-shadow:
    inset 0 0 0 1px rgba(var(--v-theme-on-primary), 0.16),
    0 1px 3px rgba(var(--v-theme-primary), 0.34);
  color: rgb(var(--v-theme-on-primary)) !important;
  opacity: 1;
  pointer-events: auto;
}

.studio-ai-sessions__tab-abandon :deep(.v-icon) {
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

.studio-ai-sessions__status-dot--abandoned,
.studio-ai-sessions__status-dot--failed {
  background: rgb(var(--v-theme-error));
}

.studio-ai-sessions__status-dot--finished {
  background: rgb(var(--v-theme-success));
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
  font-size: 0.92rem;
  height: 2rem;
  letter-spacing: 0;
  max-width: 12.5rem;
  min-height: 2rem;
}

.studio-ai-sessions__toolbar--compact .studio-ai-sessions__tab-main {
  padding-inline: 0.72rem;
}

.studio-ai-sessions__toolbar--compact .studio-ai-sessions__tab--active .studio-ai-sessions__tab-main {
  padding-inline-end: 0.28rem;
}

.studio-ai-sessions__toolbar--compact .studio-ai-sessions__tab-close-slot {
  padding-inline: 0.08rem 0.22rem;
}

.studio-ai-sessions__toolbar--compact .studio-ai-sessions__status-dot {
  height: 0.58rem;
  margin-right: 0.42rem;
  width: 0.58rem;
}

.studio-ai-sessions__toolbar--compact .studio-ai-sessions__tab-abandon {
  flex-basis: 1.42rem;
  height: 1.42rem !important;
  min-height: 1.42rem;
  min-width: 1.42rem;
  width: 1.42rem !important;
}

.studio-ai-sessions__toolbar--compact .studio-ai-sessions__tab-abandon :deep(.v-icon) {
  font-size: 1rem;
}

@media (max-width: 640px) {
  .studio-ai-sessions__toolbar {
    align-items: stretch;
    flex-direction: column;
  }
}

@media (hover: none), (pointer: coarse) {
  .studio-ai-sessions__tab .studio-ai-sessions__tab-abandon {
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
