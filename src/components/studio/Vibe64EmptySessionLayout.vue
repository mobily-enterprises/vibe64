<script setup>
// The session area with no session open: the chat column (its header, a
// hint, the empty composer rows) and the project pane (Preview's message or
// the Dashboard). The session panel fills it with its session controls; Learn
// without a practice project fills it with its welcome or "No project
// selected".
defineProps({
  chatCollapsed: Boolean,
  dashboard: Boolean,
  // Learn mode's lesson toggle is on: its #lesson slot covers Preview or the
  // Dashboard, which stay mounted under it.
  lesson: Boolean,
  hint: {
    default: "",
    type: String
  },
  previewTitle: {
    default: "",
    type: String
  },
  previewDetail: {
    default: "",
    type: String
  }
});
</script>

<template>
  <div
    class="studio-ai-sessions__empty-layout"
    :class="{
      'studio-ai-sessions__empty-layout--chat-collapsed': chatCollapsed,
      'studio-ai-sessions__empty-layout--dashboard': dashboard
    }"
  >
    <section
      class="studio-ai-sessions__empty-main"
      aria-label="Session chat"
    >
      <div class="studio-ai-sessions__empty-session-header">
        <slot name="header" />
      </div>
      <slot name="chat" />
      <div class="studio-ai-sessions__empty-chat-body">
        <div
          v-if="hint"
          class="studio-ai-sessions__empty-hint"
          role="status"
        >
          {{ hint }}
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
      class="studio-ai-sessions__empty-project-panel"
      aria-label="Project"
    >
      <div
        v-if="dashboard"
        class="studio-ai-sessions__dashboard-empty-pane"
      >
        <slot name="dashboard" />
      </div>
      <div
        v-else
        class="studio-ai-sessions__preview-empty-pane"
        data-vibe64-guide-pane="preview"
      >
        <div class="studio-ai-sessions__preview-empty-content">
          <p v-if="previewTitle" class="studio-ai-sessions__preview-empty-title">
            {{ previewTitle }}
          </p>
          <p
            v-if="previewDetail"
            class="studio-ai-sessions__preview-empty-detail"
          >
            {{ previewDetail }}
          </p>
          <slot name="preview" />
        </div>
      </div>
      <slot v-if="lesson" name="lesson" />
    </section>
  </div>
</template>

<style scoped>
.studio-ai-sessions__empty-main,
.studio-ai-sessions__empty-project-panel {
  position: relative;
}

.studio-ai-sessions__empty-layout {
  display: grid;
  gap: var(--studio-home-project-gap, 0.75rem);
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

.studio-ai-sessions__empty-main,
.studio-ai-sessions__empty-project-panel {
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-outline), 0.14);
  border-radius: 14px;
  box-shadow: 0 0.75rem 2rem rgba(15, 23, 42, 0.06);
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

.studio-ai-sessions__empty-main,
.studio-ai-sessions__empty-project-panel,
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

@media (min-width: 981px) {
  .studio-ai-sessions__empty-layout {
    grid-template-columns:
      var(--studio-home-chat-column-width, 32rem)
      minmax(0, 1fr);
  }

  .studio-ai-sessions__empty-layout--chat-collapsed {
    grid-template-columns: minmax(0, 1fr);
  }

  .studio-ai-sessions__empty-layout--chat-collapsed .studio-ai-sessions__empty-main {
    display: none;
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

  .studio-ai-sessions__empty-project-panel {
    display: none;
  }

  .studio-ai-sessions__empty-layout--chat-collapsed .studio-ai-sessions__empty-main {
    display: none;
  }

  .studio-ai-sessions__empty-layout--chat-collapsed .studio-ai-sessions__empty-project-panel {
    display: grid;
  }
}
</style>
