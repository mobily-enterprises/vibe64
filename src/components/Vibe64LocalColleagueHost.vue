<script setup>
import { ref } from "vue";
import { Vibe64Colleague } from "@local/vibe64-colleague/client";
import { Vibe64ColleagueAvatar } from "@local/vibe64-voice/client";
import { useVibe64LocalAvatarPreferences } from "@/composables/useVibe64LocalAvatarPreferences.js";
import { useVibe64ColleagueNavigation } from "@/composables/useVibe64ColleagueNavigation.js";
import { requestStudio } from "@/lib/studioUrls.js";

const { focus, navigate } = useVibe64ColleagueNavigation();
const { avatars } = useVibe64LocalAvatarPreferences();
const voiceVisual = ref(null);
</script>

<template>
  <Vibe64Colleague
    :focus="focus"
    :navigate="navigate"
    :request="requestStudio"
    @voice-visual="voiceVisual = $event"
  >
    <template #avatar="{ state }">
      <Vibe64ColleagueAvatar v-bind="voiceVisual || { state }" :avatar="avatars.colleague" />
    </template>
  </Vibe64Colleague>
</template>
