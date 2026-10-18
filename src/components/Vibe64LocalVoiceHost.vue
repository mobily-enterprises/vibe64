<script setup>
import { computed } from "vue";
import { Vibe64ColleagueAvatar, Vibe64VoiceHost } from "@local/vibe64-voice/client";
import Vibe64LocalVoiceSettings from "./Vibe64LocalVoiceSettings.vue";
import { useVibe64LocalAvatarPreferences } from "@/composables/useVibe64LocalAvatarPreferences.js";

// Standalone voice host: shared avatar artwork and its browser-local choice.
// Speaking voice and read-aloud keep their unsaved standalone behaviour.
const { avatars } = useVibe64LocalAvatarPreferences();
const preferences = computed(() => Object.fromEntries(Object.entries(avatars.value)
  .map(([target, avatar]) => [target, { avatar }])));
</script>

<template>
  <Vibe64VoiceHost :preferences="preferences">
    <template #avatar="{ mouthLevel, mouthPose, state, binding }"><Vibe64ColleagueAvatar :avatar="avatars[binding?.preferenceTarget] || avatars.coding" :mouth-level="mouthLevel" :mouth-pose="mouthPose" :state="state" /></template>
    <template #settings="{ binding, voice }"><Vibe64LocalVoiceSettings :binding="binding" :voice="voice" /></template>
    <slot />
  </Vibe64VoiceHost>
</template>
