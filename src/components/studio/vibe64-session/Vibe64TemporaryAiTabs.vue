<template>
  <nav
    class="vibe64-temporary-ai__tabs"
    aria-label="Main and temporary conversations"
  >
    <div class="vibe64-temporary-ai__tab">
      <button
        class="vibe64-temporary-ai__tab-select"
        data-temporary-ai-main-chat
        type="button"
        @click="emit('select-main-chat')"
      >
        Main chat
      </button>
    </div>
    <div class="vibe64-temporary-ai__task-tabs">
      <div
        v-for="task in props.tasks"
        :key="task.id"
        class="vibe64-temporary-ai__tab"
        :class="{ 'vibe64-temporary-ai__tab--active': task.id === props.activeTaskId }"
      >
        <button
          :ref="(element) => props.setTabButton(task.id, element)"
          :aria-current="task.id === props.activeTaskId ? 'page' : undefined"
          class="vibe64-temporary-ai__tab-select"
          :data-temporary-ai-task-id="task.id"
          :aria-label="task.unread ? `${task.label}: unread messages` : task.label"
          :title="task.unread ? `${task.label}: unread messages` : task.label"
          type="button"
          @click="emit('select-task', task.id)"
        >
          <span>{{ task.label }}</span>
          <span v-if="task.unread" class="vibe64-temporary-ai__unread" aria-hidden="true" />
          <span v-if="task.nativeWorking" class="vibe64-temporary-ai__busy" aria-label="Assistant working" />
        </button>
        <v-btn
          v-if="task.id === props.activeTaskId"
          :aria-label="`Rename ${task.label}`"
          class="vibe64-temporary-ai__tab-rename"
          data-temporary-ai-rename
          :disabled="task.state === 'closing'"
          height="32"
          :icon="mdiPencilOutline"
          min-width="32"
          size="x-small"
          :title="`Rename ${task.label}`"
          type="button"
          variant="text"
          @click="emit('rename', task)"
        />
        <v-btn
          :aria-label="`Close ${task.label}`"
          class="vibe64-temporary-ai__tab-close"
          :disabled="props.repositoryBusy || props.closingTask || props.stoppingTaskId === task.id"
          height="32"
          :icon="mdiClose"
          min-width="32"
          size="x-small"
          :title="`Close ${task.label}`"
          type="button"
          variant="text"
          @click="emit('close', task)"
        />
      </div>
      <v-btn
        :disabled="!props.sessionId"
        aria-label="New temporary AI task"
        class="vibe64-temporary-ai__new-task"
        height="32"
        :icon="mdiPlus"
        min-width="32"
        size="x-small"
        title="New temporary AI task"
        type="button"
        variant="text"
        @click="emit('new-task')"
      />
    </div>
    <span class="vibe64-temporary-ai__tabs-spacer" />
  </nav>
</template>

<script setup>
import { mdiClose, mdiPencilOutline, mdiPlus } from "@mdi/js";

// The temporary AI workspace's conversation tabs: Main chat and one tab per
// temporary chat. The selected tab is Material 3's selected chip; Main chat is
// never selected here, because choosing it closes this workspace.
const emit = defineEmits(["select-main-chat", "select-task", "rename", "close", "new-task"]);
const props = defineProps({
  tasks: { type: Array, default: () => [] },
  activeTaskId: { type: String, default: "" },
  // Remembers each task's tab button, so the workspace can reveal and focus it.
  setTabButton: { type: Function, required: true },
  sessionId: { type: String, default: "" },
  repositoryBusy: Boolean,
  closingTask: Boolean,
  stoppingTaskId: { type: String, default: "" }
});
</script>

<style scoped>
.vibe64-temporary-ai__unread {
  background: rgb(var(--v-theme-primary));
  border-radius: 50%;
  flex: 0 0 8px;
  height: 8px;
}

.vibe64-temporary-ai__tabs {
  --vibe64-temporary-ai-check: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z'/%3E%3C/svg%3E");
  align-items: flex-start;
  display: flex;
  gap: 0.25rem;
  padding: 0.25rem 0.35rem;
}

/* The padding gives a tab's focus ring room inside this scroller, which would
   clip it. The negative margins keep the strip's height, and the gap before it
   stays, so a scrolled tab never meets Main chat. */
.vibe64-temporary-ai__task-tabs {
  display: flex;
  flex: 1 1 auto;
  gap: 0.25rem;
  margin: -0.25rem -0.25rem -0.25rem 0;
  min-width: 0;
  overflow-x: auto;
  padding: 0.25rem;
  scrollbar-width: thin;
}

/* Material 3 chips: an unselected tab is outlined, and the selected one is the
   tonal selected chip with a leading check. */
.vibe64-temporary-ai__tab {
  align-items: center;
  border: 1px solid var(--v64-outline-variant);
  border-radius: var(--v64-shape-full);
  color: var(--v64-on-surface-variant);
  display: inline-flex;
  flex: 0 0 auto;
  isolation: isolate;
  max-width: 100%;
  min-height: 2rem;
  padding-left: 0.15rem;
  position: relative;
}

.vibe64-temporary-ai__tab-select {
  align-items: center;
  align-self: stretch;
  background: transparent;
  border: 0;
  color: inherit;
  cursor: pointer;
  display: inline-flex;
  font-weight: 500;
  gap: 0.35rem;
  min-width: 0;
  padding: 0.2rem 0.35rem 0.2rem 0.55rem;
}

/* The state layer covers the whole pill in the tab's content colour. */
.vibe64-temporary-ai__tab-select::after {
  background: currentColor;
  border-radius: var(--v64-shape-full);
  content: "";
  inset: 0;
  opacity: 0;
  pointer-events: none;
  position: absolute;
  transition: opacity var(--v64-duration-short) var(--v64-ease-standard);
  z-index: -1;
}

.vibe64-temporary-ai__tab-select:hover::after {
  opacity: var(--v64-state-hover);
}

.vibe64-temporary-ai__tab-select:focus-visible::after {
  opacity: var(--v64-state-focus);
}

.vibe64-temporary-ai__tab-select:active::after {
  opacity: var(--v64-state-pressed);
}

.vibe64-temporary-ai__tab-select > span:first-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vibe64-temporary-ai__tab-rename,
.vibe64-temporary-ai__tab-close {
  flex: 0 0 auto;
}

/* The keyboard focus ring goes round the whole pill. */
.vibe64-temporary-ai__tab-select:focus-visible {
  outline: none;
}

.vibe64-temporary-ai__tab:has(> .vibe64-temporary-ai__tab-select:focus-visible) {
  outline: var(--v64-focus-ring-width) solid var(--v64-focus-ring-color);
  outline-offset: var(--v64-focus-ring-offset);
}

.vibe64-temporary-ai__tab--active {
  background: var(--v64-secondary-container);
  border-color: transparent;
  color: var(--v64-on-secondary-container);
}

/* The tonal fill alone is under 3:1 against the surface, so the selected
   chip's check is the cue that stands out. */
.vibe64-temporary-ai__tab--active > .vibe64-temporary-ai__tab-select::before {
  background: currentColor;
  content: "";
  flex: 0 0 auto;
  height: 1.125rem;
  -webkit-mask: var(--vibe64-temporary-ai-check) center / contain no-repeat;
  mask: var(--vibe64-temporary-ai-check) center / contain no-repeat;
  width: 1.125rem;
}

.vibe64-temporary-ai__new-task {
  flex: 0 0 auto;
}

.vibe64-temporary-ai__tabs-spacer {
  flex: 1 1 auto;
}

.vibe64-temporary-ai__busy {
  background: rgb(var(--v-theme-primary));
  border-radius: 50%;
  height: 0.45rem;
  width: 0.45rem;
}

@media (pointer: coarse) {
  .vibe64-temporary-ai__tab-select,
  .vibe64-temporary-ai__new-task,
  .vibe64-temporary-ai__tab-rename,
  .vibe64-temporary-ai__tab-close {
    min-height: 3rem !important;
    min-width: 3rem !important;
  }
}
</style>
