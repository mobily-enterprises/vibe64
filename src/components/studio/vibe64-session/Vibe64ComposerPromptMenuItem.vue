<template>
  <div class="vibe64-composer-prompt-menu-item">
    <button
      class="vibe64-composer-prompt-menu-item__button"
      :disabled="disabled"
      type="button"
      :title="item.disabledReason || item.label"
      @click="$emit('select', item)"
    >
      <v-icon :icon="itemIcon" size="18" />
      <span>{{ item.label }}</span>
    </button>
    <button
      v-if="canInsertText"
      class="vibe64-composer-prompt-menu-item__text-button"
      :disabled="disabled"
      type="button"
      :title="`Add ${item.label} prompt to the main chat`"
      :aria-label="`Add ${item.label} prompt to the main chat`"
      @click="$emit('insert-text', item)"
    >
      <v-icon :icon="mdiTextBoxOutline" size="18" />
    </button>
  </div>
</template>

<script setup>
import { computed } from "vue";
import {
  mdiFileDocumentOutline,
  mdiTextBoxOutline
} from "@mdi/js";
import {
  presentationIconForToken
} from "@/lib/vibe64PresentationControls.js";
import {
  composerMenuItemCanInsertText
} from "@/lib/vibe64ComposerPromptRefs.js";

defineEmits([
  "insert-text",
  "select"
]);

const props = defineProps({
  disabled: {
    default: false,
    type: Boolean
  },
  item: {
    default: () => ({}),
    type: Object
  }
});

const itemIcon = computed(() => presentationIconForToken(props.item.icon, mdiFileDocumentOutline));
const canInsertText = computed(() => composerMenuItemCanInsertText(props.item));
</script>

<style scoped>
.vibe64-composer-prompt-menu-item {
  align-items: center;
  display: grid;
  gap: 0.28rem;
  grid-template-columns: minmax(0, 1fr) auto;
}

.vibe64-composer-prompt-menu-item__button,
.vibe64-composer-prompt-menu-item__text-button {
  align-items: center;
  appearance: none;
  background: rgba(var(--v-theme-on-surface), 0.035);
  border: 1px solid rgba(var(--v-theme-outline), 0.12);
  border-radius: 8px;
  color: rgba(var(--v-theme-on-surface), 0.84);
  display: inline-flex;
  font: inherit;
  gap: 0.48rem;
  line-height: 1.2;
  min-height: 2rem;
  min-width: 0;
  padding: 0.34rem 0.52rem;
  text-align: left;
}

.vibe64-composer-prompt-menu-item__button {
  justify-content: flex-start;
  width: 100%;
}

.vibe64-composer-prompt-menu-item__button span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vibe64-composer-prompt-menu-item__text-button {
  color: rgba(var(--v-theme-on-surface), 0.68);
  justify-content: center;
  width: 2.25rem;
}

.vibe64-composer-prompt-menu-item__button:hover,
.vibe64-composer-prompt-menu-item__text-button:hover {
  background: rgba(var(--v-theme-primary), 0.07);
  border-color: rgba(var(--v-theme-primary), 0.2);
}

.vibe64-composer-prompt-menu-item__button:disabled,
.vibe64-composer-prompt-menu-item__text-button:disabled {
  cursor: default;
  opacity: 0.48;
}
</style>
