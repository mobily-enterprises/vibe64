<script setup>
import { onScopeDispose, provide, shallowRef } from "vue";
import { createVoiceConversationController, VoiceConversationHost } from "@jskit-ai/assistant-voice/client";
import { VIBE64_VOICE_KEY } from "./voiceHost.js";
const props = defineProps({ preferences: { type: Object, default: () => ({}) } });
const controller = createVoiceConversationController({ connectSpeech: binding => binding.socketUrl });
const launcher = shallowRef(null);
provide(VIBE64_VOICE_KEY, {
  controller, launcher,
  open(conversation) {
    return controller.open({ conversation: { ...conversation,
      // Accessors remain live: spreading a binding would freeze state/access.
      get state() { return conversation.state; },
      get available() { return conversation.available; },
      get label() { return conversation.label; },
      get defaults() {
        return { ...conversation.defaults, ...(props.preferences.voice ? {
          voiceId: props.preferences.voice === "current" ? "" : props.preferences.voice
        } : {}) };
      },
      avatar: props.preferences.avatar
    } });
  }
});
onScopeDispose(() => { void controller.dispose(); });
</script>
<template>
  <slot />
  <VoiceConversationHost :controller="controller" :activator="launcher">
    <template #reopen />
    <template v-if="$slots.settings" #settings="settings"><slot name="settings" v-bind="settings" /></template>
    <template v-if="$slots.avatar" #avatar="visual"><slot name="avatar" v-bind="visual" /></template>
  </VoiceConversationHost>
</template>
