<script setup>
import { useVibe64ChatColumnResize } from "@/composables/useVibe64ChatColumnResize.js";

// The session area: the chat column and the project pane, split by the chat
// resize slider. The session panel renders it, and so does Learn without a
// practice project, so both keep the same layout and the remembered width.
defineProps({
  chatCollapsed: Boolean
});

const {
  bounds,
  resizing,
  resizeWithKeyboard,
  separator,
  startResize,
  width
} = useVibe64ChatColumnResize();
</script>

<template>
  <v-sheet
    rounded="lg"
    class="studio-ai-sessions studio-ai-sessions--autopilot studio-screen__panel"
    :class="{ 'studio-ai-sessions--resizing': resizing }"
  >
    <div
      v-show="!chatCollapsed"
      ref="separator"
      class="studio-ai-sessions__chat-column-separator"
      :class="{
        'studio-ai-sessions__chat-column-separator--resizing': resizing
      }"
      aria-label="Resize chat"
      aria-orientation="vertical"
      :aria-valuemax="bounds.max"
      :aria-valuemin="bounds.min"
      :aria-valuenow="width"
      role="separator"
      tabindex="0"
      title="Resize chat"
      @keydown="resizeWithKeyboard"
      @pointerdown="startResize"
    />
    <slot />
  </v-sheet>
</template>

<style scoped>
.studio-ai-sessions {
  display: grid;
  gap: 0.85rem;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  position: relative;
}

.studio-ai-sessions--autopilot {
  background: transparent;
  border-radius: 0 !important;
  box-shadow: none;
  gap: 0;
  grid-template-rows: minmax(0, 1fr);
  padding: 0;
}

.studio-ai-sessions__chat-column-separator {
  background: transparent;
  bottom: 0;
  cursor: col-resize;
  left: var(--studio-home-chat-column-width, 32rem);
  outline: none;
  position: absolute;
  top: 0;
  touch-action: none;
  user-select: none;
  width: var(--studio-home-project-gap, 0.75rem);
  z-index: 10;
}

.studio-ai-sessions__chat-column-separator::before {
  background: rgba(var(--v-theme-on-surface), 0.14);
  bottom: 0;
  content: "";
  left: 50%;
  position: absolute;
  top: 0;
  transform: translateX(-50%);
  transition: background-color 120ms ease, width 120ms ease;
  width: 1px;
}

.studio-ai-sessions__chat-column-separator:hover::before,
.studio-ai-sessions__chat-column-separator:focus-visible::before,
.studio-ai-sessions__chat-column-separator--resizing::before {
  background: rgb(var(--v-theme-primary));
  width: 2px;
}

.studio-ai-sessions--resizing {
  cursor: col-resize !important;
  user-select: none !important;
}

@media (min-width: 981px) {
  .studio-ai-sessions {
    grid-template-rows: auto minmax(0, 1fr);
  }

  .studio-ai-sessions--autopilot {
    grid-template-rows: minmax(0, 1fr);
  }
}

@media (max-width: 980px) {
  .studio-ai-sessions__chat-column-separator {
    display: none !important;
  }
}

.studio-ai-sessions--autopilot.studio-ai-sessions--unavailable {
  grid-template-rows: auto minmax(0, 1fr);
}
</style>
