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
          'studio-ai-sessions__tab--thinking': sessionItem.codexThinking
        }"
        :size="compact ? 'small' : 'large'"
        variant="flat"
        @click="toolbar.selectSession(sessionItem.sessionId)"
      >
        <span
          class="studio-ai-sessions__status-dot"
          :class="`studio-ai-sessions__status-dot--${sessionItem.status}`"
        />
        <span class="studio-ai-sessions__tab-label">{{ sessionTabLabel(sessionItem) }}</span>
        <v-btn
          v-if="sessionItem.sessionId === selectedSessionId"
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
  align-items: center;
  background: var(--studio-control-rest-bg, #f7f7f8) !important;
  border: 1px solid transparent;
  border-radius: 999px;
  box-shadow: none !important;
  color: var(--studio-control-text, #202124) !important;
  font-weight: 500;
  max-width: 18rem;
  position: relative;
}

.studio-ai-sessions__tab:hover {
  border-color: var(--studio-control-border, rgba(17, 24, 39, 0.12));
}

.studio-ai-sessions__tab--active {
  background: var(--studio-control-active-bg, #e7e7e7) !important;
  border-color: transparent;
  color: var(--studio-control-text, #202124) !important;
  font-weight: 560;
  padding-inline-end: 2.05rem;
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

.studio-ai-sessions__tab-abandon {
  color: rgba(32, 33, 36, 0.82) !important;
  min-height: 1.75rem;
  min-width: 1.75rem;
  opacity: 0;
  pointer-events: none;
  position: absolute;
  right: 0.12rem;
  top: 50%;
  transform: translateY(-50%);
  transition: opacity 120ms ease;
  z-index: 2;
}

.studio-ai-sessions__tab:hover .studio-ai-sessions__tab-abandon,
.studio-ai-sessions__tab:focus-within .studio-ai-sessions__tab-abandon {
  background: rgba(17, 24, 39, 0.08) !important;
  opacity: 0.78;
  pointer-events: auto;
}

.studio-ai-sessions__tab-abandon:hover,
.studio-ai-sessions__tab-abandon:focus-visible {
  background: rgba(17, 24, 39, 0.16) !important;
  color: var(--studio-control-text, #202124) !important;
  opacity: 1;
  pointer-events: auto;
}

.studio-ai-sessions__tab-abandon :deep(.v-icon) {
  font-size: 1.15rem;
}

.studio-ai-sessions__status-dot {
  background: rgb(var(--v-theme-primary));
  border-radius: 999px;
  display: inline-block;
  flex: 0 0 auto;
  height: 0.52rem;
  margin-right: 0.42rem;
  position: relative;
  width: 0.52rem;
}

.studio-ai-sessions__tab--thinking .studio-ai-sessions__status-dot::after {
  animation: studio-ai-sessions-status-thinking 1.35s ease-out infinite;
  border: 2px solid rgba(var(--v-theme-primary), 0.64);
  border-radius: 999px;
  content: "";
  inset: -0.26rem;
  opacity: 0;
  pointer-events: none;
  position: absolute;
  transform: scale(0.8) translateZ(0);
  will-change: opacity, transform;
}

.studio-ai-sessions__tab--thinking .studio-ai-sessions__status-dot {
  animation: studio-ai-sessions-status-dot-breathe 1s ease-in-out infinite;
  box-shadow: 0 0 0 0.18rem rgba(var(--v-theme-primary), 0.18);
}

.studio-ai-sessions__status-dot--abandoned,
.studio-ai-sessions__status-dot--failed {
  background: rgb(var(--v-theme-error));
}

.studio-ai-sessions__status-dot--finished {
  background: rgb(var(--v-theme-success));
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
  padding-inline: 0.72rem;
}

.studio-ai-sessions__toolbar--compact .studio-ai-sessions__status-dot {
  height: 0.58rem;
  margin-right: 0.42rem;
  width: 0.58rem;
}

.studio-ai-sessions__toolbar--compact .studio-ai-sessions__tab-abandon {
  min-height: 1.82rem;
  min-width: 1.82rem;
  right: 0.08rem;
}

.studio-ai-sessions__toolbar--compact .studio-ai-sessions__tab-abandon :deep(.v-icon) {
  font-size: 1.15rem;
}

@media (max-width: 640px) {
  .studio-ai-sessions__toolbar {
    align-items: stretch;
    flex-direction: column;
  }
}

@media (prefers-reduced-motion: reduce) {
  .studio-ai-sessions__tab--thinking .studio-ai-sessions__status-dot {
    animation: none;
  }

  .studio-ai-sessions__tab--thinking .studio-ai-sessions__status-dot::after {
    animation: none;
    opacity: 0.55;
    transform: scale(1.45) translateZ(0);
  }
}

@keyframes studio-ai-sessions-status-dot-breathe {
  0%,
  100% {
    box-shadow: 0 0 0 0.12rem rgba(var(--v-theme-primary), 0.14);
    transform: scale(1) translateZ(0);
  }

  50% {
    box-shadow: 0 0 0 0.22rem rgba(var(--v-theme-primary), 0.26);
    transform: scale(1.18) translateZ(0);
  }
}

@keyframes studio-ai-sessions-status-thinking {
  0% {
    opacity: 0.58;
    transform: scale(0.8) translateZ(0);
  }

  72%,
  100% {
    opacity: 0;
    transform: scale(1.75) translateZ(0);
  }
}
</style>
