<script setup>
import { computed, onMounted, ref } from "vue";
import { VoiceSpeakingVoiceSelect } from "@jskit-ai/assistant-voice/client";
import { Vibe64AvatarSetting } from "@local/vibe64-voice/client";
import { useVibe64LocalAvatarPreferences } from "@/composables/useVibe64LocalAvatarPreferences.js";

/**
 * The speech service's voice as JSKIT's voice host hands it to its settings: this view connects it, and JSKIT's
 * selector reads its voices.
 * @typedef {{ connect: () => Promise<unknown> }} SpeakingVoice
 */

// Standalone voice settings: the browser-local avatar choice, followed by the
// speech service's own speaking-voice selector, reused from JSKIT.
const props = defineProps({
  binding: { type: /** @type {import("vue").PropType<{ preferenceTarget?: string } | null>} */ (Object), default: null },
  // readable-check: allow collaborator-prop - optional operation: a voice host without a speech service passes no voice, so only the avatar choice shows
  voice: { type: /** @type {import("vue").PropType<SpeakingVoice | null>} */ (Object), default: null }
});
const hasVoice = computed(() => props.voice !== null);
const { avatars, setAvatar } = useVibe64LocalAvatarPreferences();
const voiceError = ref("");
onMounted(async () => {
  if (!hasVoice.value) return;
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
  <template v-if="hasVoice">
    <v-alert v-if="voiceError" type="error" density="compact" class="mt-3">{{ voiceError }}</v-alert>
    <VoiceSpeakingVoiceSelect :voice="voice" class="mt-3" />
  </template>
</template>
