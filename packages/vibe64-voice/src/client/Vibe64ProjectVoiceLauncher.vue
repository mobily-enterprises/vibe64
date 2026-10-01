<script setup>
import { mdiHeadset } from "@mdi/js";
import { ref } from "vue";
import { useVibe64Voice } from "./voiceHost.js";
import { createProjectVoiceBinding } from "./projectVoiceBinding.js";
const props = defineProps({ runtime: { type: Object, required: true } });
const voice = useVibe64Voice();
const error = ref("");
async function open() {
  error.value = "";
  try { await voice.open(createProjectVoiceBinding(props.runtime)); }
  catch (failure) { error.value = failure.message; }
}
</script>
<template>
  <v-btn
    v-if="voice" :icon="mdiHeadset" variant="text" size="small" min-height="48" min-width="48"
    aria-label="Talk to project agent" title="Talk to project agent" :disabled="!runtime.available.value" @click="open"
  />
  <span v-if="error" role="alert" class="text-error">{{ error }}</span>
</template>
