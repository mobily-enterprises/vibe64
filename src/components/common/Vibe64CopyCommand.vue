<template>
  <div class="v64-copy-command">
    <code class="v64-copy-command__text">{{ command }}</code>
    <v-tooltip :text="copied ? 'Copied' : label" location="top">
      <template #activator="{ props: tooltipProps }">
        <v-btn
          v-bind="tooltipProps"
          :aria-label="copied ? 'Copied' : label"
          :color="copied ? 'success' : undefined"
          :icon="copied ? mdiCheck : mdiContentCopy"
          class="v64-copy-command__button"
          density="comfortable"
          size="small"
          variant="text"
          @click="copy"
        />
      </template>
    </v-tooltip>
    <span class="v64-copy-command__status" aria-live="polite">{{ copied ? "Copied" : "" }}</span>
  </div>
</template>

<script setup>
// One command the person runs in their own terminal, with a copy button.
import { onScopeDispose, ref } from "vue";
import { mdiCheck, mdiContentCopy } from "@mdi/js";
import { writeClipboardText } from "@/lib/clipboard.js";

const props = defineProps({
  command: { type: String, required: true },
  label: { type: String, default: "Copy command" }
});
const copied = ref(false);
let timer = null;

async function copy() {
  try {
    copied.value = await writeClipboardText(props.command);
  } catch {
    copied.value = false;
  }
  clearTimeout(timer);
  timer = setTimeout(() => { copied.value = false; }, 2000);
}
onScopeDispose(() => clearTimeout(timer));
</script>

<style scoped>
.v64-copy-command {
  align-items: center;
  background: var(--v64-surface-container-highest);
  border: 1px solid var(--v64-outline-variant);
  border-radius: var(--v64-shape-sm, 8px);
  display: flex;
  gap: 4px;
  max-width: 100%;
  min-height: 44px;
  min-width: 0;
  padding: 6px 4px 6px 12px;
}

.v64-copy-command__text {
  background: none;
  color: var(--v64-on-surface);
  flex: 1;
  font-family: ui-monospace, "SFMono-Regular", "JetBrains Mono", Menlo, Consolas, monospace;
  font-size: 0.8125rem;
  line-height: 1.6;
  min-width: 0;
  overflow-wrap: anywhere;
  padding: 0;
  /* Long lines wrap: on a phone the row never scrolls sideways or widens its card. */
  white-space: pre-wrap;
}

.v64-copy-command__button {
  flex: none;
}

.v64-copy-command__status {
  clip: rect(0 0 0 0);
  height: 1px;
  overflow: hidden;
  position: absolute;
  width: 1px;
}
</style>
