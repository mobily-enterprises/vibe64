<script setup>
import { computed, ref, watch } from "vue";
import { mdiEyeOffOutline, mdiEyeOutline } from "@mdi/js";

// One engine's custom model endpoint: the address of a model server the owner
// already runs or reaches, its exact model name, the context it loads and an
// optional key. Vibe64 never installs or starts the server.
const props = defineProps({
  engineId: { type: String, default: "codex" },
  // What was saved: { baseUrl, model, contextWindow, keySaved }, never the key.
  endpoint: { type: Object, default: null },
  connected: Boolean,
  busy: Boolean,
  disabled: Boolean
});
const emit = defineEmits(["submit"]);
const MINIMUM_CONTEXT = 32768;
const DEFAULT_CONTEXT = 65536;
const ADDRESS = Object.freeze({
  codex: { example: "http://127.0.0.1:11434/v1", hint: "An OpenAI Responses-compatible address, which usually ends in /v1." },
  opencode: { example: "http://127.0.0.1:11434/v1", hint: "An OpenAI-compatible address, which usually ends in /v1." },
  claude: { example: "http://127.0.0.1:11434", hint: "An Anthropic-compatible address, without /v1." }
});
const address = computed(() => ADDRESS[props.engineId] || ADDRESS.codex);
const baseUrl = ref("");
const model = ref("");
const contextWindow = ref(DEFAULT_CONTEXT);
const apiKey = ref("");
const visible = ref(false);
watch(() => [props.engineId, props.endpoint], () => {
  baseUrl.value = props.endpoint?.baseUrl || "";
  model.value = props.endpoint?.model || "";
  contextWindow.value = props.endpoint?.contextWindow || DEFAULT_CONTEXT;
  apiKey.value = "";
  visible.value = false;
}, { immediate: true });
const contextValid = computed(() => Number.isSafeInteger(Number(contextWindow.value)) && Number(contextWindow.value) >= MINIMUM_CONTEXT);
const canSubmit = computed(() => Boolean(baseUrl.value.trim() && model.value.trim() && contextValid.value));

function submit() {
  const key = apiKey.value.trim();
  emit("submit", {
    apiKey: key,
    // An empty field keeps a key saved earlier.
    useSavedKey: !key && props.endpoint?.keySaved === true,
    endpoint: { baseUrl: baseUrl.value.trim(), model: model.value.trim(), contextWindow: Number(contextWindow.value) }
  });
}
</script>

<template>
  <v-form :disabled="disabled || busy" class="custom-endpoint" @submit.prevent="submit">
    <v-text-field
      v-model="baseUrl" label="Base URL" :placeholder="address.example" :hint="address.hint" persistent-hint
      variant="outlined" autocomplete="off" spellcheck="false" class="mb-3"
    />
    <v-text-field
      v-model="model" label="Model name" placeholder="qwen3.5:4b" variant="outlined" autocomplete="off" spellcheck="false"
      hint="Exactly as your server names it. The model must support tool calling." persistent-hint class="mb-3"
    />
    <v-text-field
      v-model.number="contextWindow" label="Context length (tokens)" type="number" :min="MINIMUM_CONTEXT" step="1024"
      variant="outlined" :error-messages="contextValid ? [] : [`At least ${MINIMUM_CONTEXT.toLocaleString('en-US')} tokens.`]"
      hint="The engine compacts the conversation before it reaches this length." persistent-hint class="mb-3"
    />
    <v-text-field
      v-model="apiKey" :label="endpoint?.keySaved ? 'Replace key (optional)' : 'Key (optional)'" :type="visible ? 'text' : 'password'"
      :append-inner-icon="visible ? mdiEyeOffOutline : mdiEyeOutline" autocomplete="off" spellcheck="false" variant="outlined"
      :hint="endpoint?.keySaved ? 'Leave empty to keep the saved key. Keys are never shown again.'
        : 'Only if your server asks for one. Stored privately outside your projects.'"
      persistent-hint @click:append-inner="visible = !visible"
    />
    <v-alert type="info" variant="tonal" density="compact" class="my-4 text-body-small" data-test="custom-endpoint-context">
      Your server must load the model with at least this context. Ollama uses 4,096 on most GPUs and silently cuts
      longer prompts: start it with <code>OLLAMA_CONTEXT_LENGTH=65536</code>, or raise the context in LM Studio,
      <code>llama-server -c</code> or vLLM <code>--max-model-len</code>. The address must be reachable from the
      computer Vibe64 runs on.
    </v-alert>
    <v-btn type="submit" color="primary" variant="flat" :loading="busy" :disabled="disabled || !canSubmit">
      {{ connected ? "Check and save" : "Check and connect" }}
    </v-btn>
  </v-form>
</template>

<style scoped>
.custom-endpoint { min-width: 0; }
</style>
