<template>
  <nav
    class="vibe64-temporary-ai__tabs"
    aria-label="Main and temporary conversations"
  >
    <div class="vibe64-temporary-ai__tab vibe64-temporary-ai__tab--main">
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
// temporary chat.
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
  align-items: flex-start;
  background: rgba(var(--v-theme-tertiary), 0.06);
  border-bottom: 1px solid rgba(var(--v-theme-tertiary), 0.18);
  display: flex;
  gap: 0.25rem;
  padding: 0.25rem 0.35rem;
}

.vibe64-temporary-ai__task-tabs {
  display: flex;
  flex: 1 1 auto;
  gap: 0.25rem;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: thin;
}

.vibe64-temporary-ai__tab {
  align-items: center;
  background: rgba(var(--v-theme-on-surface), 0.05);
  border: 1px solid transparent;
  border-radius: 999px;
  color: inherit;
  display: inline-flex;
  flex: 0 0 auto;
  max-width: 100%;
  min-height: 2rem;
  padding-left: 0.15rem;
}

.vibe64-temporary-ai__tab-select {
  align-items: center;
  align-self: stretch;
  background: transparent;
  border: 0;
  color: inherit;
  cursor: pointer;
  display: inline-flex;
  gap: 0.35rem;
  min-width: 0;
  padding: 0.2rem 0.35rem 0.2rem 0.55rem;
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

.vibe64-temporary-ai__tab-select:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 2px;
}

.vibe64-temporary-ai__tab--active {
  background: rgb(var(--v-theme-surface));
  border-color: rgba(var(--v-theme-tertiary), 0.35);
  font-weight: 650;
}

.vibe64-temporary-ai__tab--main {
  background: rgb(var(--v-theme-surface));
  border-color: rgba(var(--v-theme-tertiary), 0.22);
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
