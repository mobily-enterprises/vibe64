<script setup>
import { computed, ref } from "vue";
import { mdiChevronDown, mdiRobotOutline } from "@mdi/js";

// A custom endpoint is for advanced users, so each tool's provider picker keeps
// it in this collapsed Advanced section with the API that tool needs.
const props = defineProps({
  engineId: { type: String, default: "codex" },
  disabled: Boolean
});
const emit = defineEmits(["choose"]);
const API_NOTES = Object.freeze({
  codex: "Codex needs the OpenAI Responses API. Its base URL usually ends in /v1.",
  claude: "Claude Code needs the Anthropic Messages API. Its base URL has no /v1.",
  opencode: "OpenCode needs OpenAI Chat Completions. Its base URL usually ends in /v1."
});
const apiNote = computed(() => API_NOTES[props.engineId] || API_NOTES.codex);
const bodyId = computed(() => `custom-endpoint-advanced-${props.engineId}`);
const open = ref(false);
</script>

<template>
  <section class="custom-endpoint-advanced">
    <v-btn
      variant="text" size="small" class="custom-endpoint-advanced__toggle" :class="{ 'is-open': open }"
      :append-icon="mdiChevronDown" :aria-expanded="String(open)" :aria-controls="bodyId" @click="open = !open"
    >
      Advanced
    </v-btn>
    <v-expand-transition>
      <div v-if="open" :id="bodyId" class="custom-endpoint-advanced__body">
        <p class="text-body-small">{{ apiNote }} Ollama serves the APIs all three tools need.</p>
        <v-alert type="warning" variant="tonal" density="compact" class="text-body-small">
          Never expose a model server to the internet without a key or a private tunnel.
        </v-alert>
        <v-sheet border rounded="xl">
          <v-list lines="two" aria-label="Your own model server">
            <v-list-item
              title="Custom endpoint" subtitle="A model server you run or reach, such as Ollama or LM Studio"
              :disabled="disabled" @click="emit('choose')"
            >
              <template #prepend>
                <v-avatar color="primary" size="44" variant="tonal">
                  <v-icon :icon="mdiRobotOutline" size="22" />
                </v-avatar>
              </template>
              <template #append><span class="text-label-large text-primary">Connect</span></template>
            </v-list-item>
          </v-list>
        </v-sheet>
      </div>
    </v-expand-transition>
  </section>
</template>

<style scoped>
.custom-endpoint-advanced { margin-top: var(--v64-space-3); }
.custom-endpoint-advanced__toggle { margin-inline-start: calc(var(--v64-space-3) * -1); }
.custom-endpoint-advanced__toggle :deep(.v-btn__append) { transition: transform var(--v64-duration-short) var(--v64-ease-standard); }
.custom-endpoint-advanced__toggle.is-open :deep(.v-btn__append) { transform: rotate(180deg); }
.custom-endpoint-advanced__body { display: grid; gap: var(--v64-space-3); margin-top: var(--v64-space-2); }
.custom-endpoint-advanced__body p { margin: 0; }
@media (prefers-reduced-motion: reduce) {
  .custom-endpoint-advanced__toggle :deep(.v-btn__append) { transition: none; }
}
</style>
