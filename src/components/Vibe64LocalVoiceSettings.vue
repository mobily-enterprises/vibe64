<script setup>
import { onMounted, ref } from "vue";
import { Vibe64AvatarSetting } from "@local/vibe64-voice/client";
import { useVibe64LocalAvatarPreferences } from "@/composables/useVibe64LocalAvatarPreferences.js";

// Standalone voice settings: the browser-local avatar choice, followed by the
// speech service's own speaking-voice selector that this slot replaces.
const props = defineProps({
  binding: { type: Object, default: null },
  voice: { type: Object, default: null }
});
const { avatars, setAvatar } = useVibe64LocalAvatarPreferences();
const voiceError = ref("");
function selectVoice(value) {
  const selectedVoice = props.voice.selectedVoice;
  selectedVoice.value = value;
}
onMounted(async () => {
  if (!props.voice) return;
  try { await props.voice.connect(); }
  catch (error) { voiceError.value = error?.message || "Speaking voices could not load."; }
});
</script>

<template>
  <Vibe64AvatarSetting
    v-if="binding?.preferenceTarget"
    :model-value="avatars[binding.preferenceTarget]"
    hint="Saved in this browser for this assistant type."
    @update:model-value="value => setAvatar(binding.preferenceTarget, value)"
  />
  <template v-if="voice">
    <v-alert v-if="voiceError" type="error" density="compact" class="mt-3">{{ voiceError }}</v-alert>
    <v-select
      :model-value="voice.selectedVoice.value" @update:model-value="selectVoice"
      :items="voice.availableVoices.value" item-title="label" item-value="id"
      :disabled="voice.availableVoices.value.length < 2"
      label="Speaking voice" density="comfortable" class="mt-3"
      hint="Applies to the next spoken reply" persistent-hint
    />
  </template>
</template>
