<template>
  <v-sheet
    rounded="lg"
    color="surface"
    class="vibe64-terminal-frame"
  >
    <div
      class="vibe64-terminal-frame__bar"
      :class="{
        'vibe64-terminal-frame__bar--draggable': draggable
      }"
      @pointerdown="startDrag"
    >
      <div class="vibe64-terminal-frame__heading">
        <div class="vibe64-terminal-frame__title">{{ title }}</div>
        <div class="vibe64-terminal-frame__subtitle">{{ subtitle }}</div>
      </div>
      <div class="vibe64-terminal-frame__actions" @pointerdown.stop>
        <slot name="actions" />
      </div>
    </div>

    <StudioErrorNotice
      v-if="error"
      title="Terminal needs attention"
      :error="error"
      compact
      class="mb-2"
    />

    <div :ref="terminalHostRef" class="vibe64-terminal-frame__host" />

    <div class="vibe64-terminal-frame__footer">
      <span>{{ commandPreview || "No command running." }}</span>
      <v-chip v-if="status" size="x-small" variant="tonal">
        {{ status }}
      </v-chip>
    </div>
  </v-sheet>
</template>

<script setup>
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";

const props = defineProps({
  commandPreview: {
    type: String,
    default: ""
  },
  draggable: {
    type: Boolean,
    default: false
  },
  error: {
    type: String,
    default: ""
  },
  status: {
    type: String,
    default: ""
  },
  subtitle: {
    type: String,
    default: ""
  },
  terminalHostRef: {
    type: Function,
    default: null
  },
  title: {
    type: String,
    default: "Terminal"
  }
});

const emit = defineEmits(["drag-start"]);

function startDrag(event) {
  if (!props.draggable || event.button !== 0) {
    return;
  }
  emit("drag-start", event);
}
</script>

<style scoped>
.vibe64-terminal-frame {
  color: rgb(var(--v-theme-on-surface));
  min-width: 0;
  padding: 0.75rem;
  text-align: left;
}

.vibe64-terminal-frame__bar,
.vibe64-terminal-frame__footer {
  align-items: center;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
  min-width: 0;
}

.vibe64-terminal-frame__bar {
  margin-bottom: 0.5rem;
}

.vibe64-terminal-frame__bar--draggable {
  cursor: move;
  touch-action: none;
  user-select: none;
}

.vibe64-terminal-frame__heading {
  flex: 1 1 auto;
  min-width: 0;
}

.vibe64-terminal-frame__title {
  font-size: 0.85rem;
  font-weight: 700;
}

.vibe64-terminal-frame__subtitle,
.vibe64-terminal-frame__footer {
  color: rgba(var(--v-theme-on-surface), 0.72);
  font-size: 0.75rem;
}

.vibe64-terminal-frame__actions {
  align-items: center;
  cursor: default;
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  justify-content: flex-end;
  min-width: 0;
}

.vibe64-terminal-frame__host {
  background: #101216;
  border-radius: 0.45rem;
  height: clamp(18rem, 48vh, 34rem);
  overflow: hidden;
}

.vibe64-terminal-frame__footer {
  margin-top: 0.45rem;
  overflow: hidden;
}

.vibe64-terminal-frame__footer span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
