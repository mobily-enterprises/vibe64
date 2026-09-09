<template>
  <section
    class="vibe64-prompt-hints"
    :class="`vibe64-prompt-hints--${mode}`"
    data-vibe64-prompt-hints
    @focusout="$emit('focusout', $event)"
    @keydown.esc.stop.prevent="$emit('dismiss')"
  >
    <span
      :id="statusId || undefined"
      aria-atomic="true"
      aria-live="polite"
      class="vibe64-prompt-hints__sr-status"
      role="status"
    >{{ statusAnnouncement }}</span>

    <div
      v-if="mode === 'assistant'"
      aria-hidden="true"
      class="vibe64-prompt-hints__assistant-status"
    >
      <span class="vibe64-prompt-hints__assistant-mark" />
      <span>{{ assistantLabel }}</span>
    </div>

    <template v-else-if="mode !== 'hidden'">
      <v-icon
        aria-hidden="true"
        class="vibe64-prompt-hints__marker"
        :icon="mdiLightbulbOnOutline"
        size="16"
      />

      <div
        v-if="mode === 'loading'"
        aria-hidden="true"
        class="vibe64-prompt-hints__loading"
      >
        <span>Thinking of a few ideas</span>
      </div>

      <div
        v-else
        class="vibe64-prompt-hints__options"
        aria-label="Suggested prompts"
        aria-orientation="horizontal"
        role="group"
      >
        <v-btn
          v-for="suggestion in suggestions"
          :key="suggestion.prompt"
          :aria-label="`Use suggestion: ${suggestion.prompt}`"
          class="vibe64-prompt-hints__option"
          rounded="xl"
          size="small"
          type="button"
          variant="tonal"
          @blur="$emit('preview', null)"
          @mousedown.prevent
          @focus="$emit('preview', suggestion)"
          @mouseenter="$emit('preview', suggestion)"
          @mouseleave="$emit('preview', null)"
          @click="$emit('select', suggestion)"
        >
          <span>{{ suggestion.label }}</span>
        </v-btn>
      </div>
    </template>
  </section>
</template>

<script setup>
import { computed } from "vue";
import { mdiLightbulbOnOutline } from "@mdi/js";

defineEmits(["dismiss", "focusout", "preview", "select"]);
const props = defineProps({
  assistantLabel: {
    default: "",
    type: String
  },
  loading: {
    default: false,
    type: Boolean
  },
  statusId: {
    default: "",
    type: String
  },
  suggestions: {
    default: () => [],
    type: Array
  }
});

const mode = computed(() => {
  if (String(props.assistantLabel || "").trim()) {
    return "assistant";
  }
  if (props.loading) {
    return "loading";
  }
  return props.suggestions.length === 3 ? "ready" : "hidden";
});
const statusAnnouncement = computed(() => {
  if (mode.value === "assistant") {
    return String(props.assistantLabel || "").trim();
  }
  if (mode.value === "loading") {
    return "Thinking of a few ideas.";
  }
  if (mode.value === "ready") {
    return "Three suggested prompts are available before the message controls.";
  }
  return "";
});
</script>

<style scoped>
.vibe64-prompt-hints {
  align-items: center;
  box-sizing: border-box;
  color: rgba(var(--v-theme-on-surface), 0.68);
  display: grid;
  grid-row: 4;
  grid-template-columns: 1.25rem minmax(0, 1fr);
  height: 2.25rem;
  max-width: 100%;
  min-height: 2.25rem;
  min-width: 0;
  overflow: hidden;
  padding-inline: 0.2rem;
  width: 100%;
}

.vibe64-prompt-hints__sr-status {
  block-size: 1px;
  clip-path: inset(50%);
  inline-size: 1px;
  overflow: hidden;
  position: absolute;
  white-space: nowrap;
}

.vibe64-prompt-hints__marker {
  justify-self: center;
}

.vibe64-prompt-hints__assistant-status,
.vibe64-prompt-hints__loading {
  align-items: center;
  display: flex;
}

.vibe64-prompt-hints__assistant-status {
  font-size: 0.78rem;
  gap: 0.45rem;
  grid-column: 1 / -1;
  line-height: 1.35;
  min-width: 0;
  overflow-wrap: anywhere;
  padding-inline: 0.55rem;
}

.vibe64-prompt-hints__assistant-mark {
  animation: vibe64-prompt-hints-pulse 1.2s ease-in-out infinite;
  background: rgb(var(--v-theme-primary));
  border-radius: 50%;
  height: 0.42rem;
  width: 0.42rem;
}

.vibe64-prompt-hints__loading {
  font-size: 0.76rem;
  grid-column: 2;
  min-width: 0;
  padding-inline: 0.5rem;
}

.vibe64-prompt-hints__options {
  align-items: center;
  box-sizing: border-box;
  display: flex;
  gap: 0.35rem;
  grid-column: 2;
  height: 100%;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  overscroll-behavior-inline: contain;
  padding: 0.1rem 0.2rem;
  scroll-snap-type: inline proximity;
  scrollbar-width: none;
  width: 100%;
}

.vibe64-prompt-hints__options::-webkit-scrollbar {
  display: none;
}

.vibe64-prompt-hints__option {
  color: rgb(var(--v-theme-on-surface));
  flex: 0 0 auto;
  font-size: 0.75rem;
  font-weight: 500;
  letter-spacing: 0;
  line-height: 1.25;
  min-width: 0;
  padding-inline: 0.65rem;
  scroll-snap-align: start;
  text-transform: none;
}

.vibe64-prompt-hints__option span {
  white-space: nowrap;
}

@keyframes vibe64-prompt-hints-pulse {
  0%,
  100% {
    opacity: 0.35;
    transform: scale(0.8);
  }
  50% {
    opacity: 1;
    transform: scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .vibe64-prompt-hints__assistant-mark {
    animation: none;
    opacity: 1;
    transform: none;
  }
}
</style>
