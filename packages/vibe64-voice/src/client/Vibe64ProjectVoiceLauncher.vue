<script setup>
import { mdiHeadset } from "@mdi/js";
import { ref } from "vue";
import { useVibe64Voice } from "./voiceHost.js";
import { createProjectVoiceBinding } from "./projectVoiceBinding.js";
const props = defineProps({
  runtime: { type: Object, required: true },
  binding: { type: Object, default: null }
});
const emit = defineEmits(["opened"]);
const voice = useVibe64Voice();
const error = ref("");
async function open() {
  error.value = "";
  try {
    if (await voice.open(props.binding || createProjectVoiceBinding(props.runtime))) emit("opened");
  }
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
