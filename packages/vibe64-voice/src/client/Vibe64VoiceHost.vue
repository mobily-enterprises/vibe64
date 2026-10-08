<script setup>
import { onScopeDispose, provide, shallowRef, useSlots } from "vue";
import { createVoiceConversationController, VoiceConversationHost } from "@jskit-ai/assistant-voice/client";
import { VIBE64_VOICE_KEY } from "./voiceHost.js";
const props = defineProps({
  preferences: { type: Object, default: () => ({}) },
  preparePreferences: { type: Function, default: null }
});
const emit = defineEmits(["read-aloud-change", "playback"]);
const controller = createVoiceConversationController({ connectSpeech(binding) {
  if (!binding.prepareVoice) return binding.socketUrl;
  return binding.prepareVoice().then(() => binding.socketUrl);
} });
const launcher = shallowRef(null);
const slots = useSlots();
const Avatar = visual => slots.avatar?.(visual);
const Settings = settings => slots.settings?.(settings);
function preferencesFor(conversation) {
  return props.preferences[conversation.preferenceTarget] || {};
}
function readAloudFor(conversation) {
  const value = preferencesFor(conversation).readAloud;
  return typeof value === "boolean" ? value : conversation.defaults?.readAloud === true;
}
function readAloudChangePendingFor(conversation) {
  return preferencesFor(conversation).isSaving === true;
}
provide(VIBE64_VOICE_KEY, {
  controller, launcher,
  readAloudFor, readAloudChangePendingFor,
  Avatar: slots.avatar ? Avatar : null,
  Settings: slots.settings ? Settings : null,
  open(conversation) {
    let actorKey = props.preferences.actorKey;
    return controller.open({ conversation: { ...conversation,
      ...(props.preparePreferences ? { async prepareVoice() {
        actorKey = await props.preparePreferences(conversation.preferenceTarget);
        if (!actorKey || props.preferences.actorKey !== actorKey || conversation.available === false) {
          throw new Error("This conversation is no longer available for voice.");
        }
        await conversation.prepareVoice?.();
        if (props.preferences.actorKey !== actorKey || conversation.available === false) {
          throw new Error("This conversation is no longer available for voice.");
        }
      } } : {}),
      // Accessors remain live: spreading a binding would freeze state/access.
      get state() { return conversation.state; },
      get available() { return conversation.available; },
      get label() { return conversation.label; },
      get adapter() { return conversation.adapter; },
      get onTranscript() { return conversation.onTranscript; },
      get presentation() { return conversation.presentation; },
      get readAloudChangePending() { return readAloudChangePendingFor(conversation); },
      get narration() {
        const narration = conversation.narration;
        if (!narration) return narration;
        const preferences = conversation.preferenceTarget === "coding" ? preferencesFor(conversation) : {};
        return {
          ...narration,
          vocalizeThinking: typeof preferences.vocalizeThinking === "boolean" ? preferences.vocalizeThinking : narration.vocalizeThinking,
          vocalizeInterimTurns: typeof preferences.vocalizeInterimTurns === "boolean" ? preferences.vocalizeInterimTurns : narration.vocalizeInterimTurns,
          thinkingSounds: typeof preferences.thinkingSounds === "boolean" ? preferences.thinkingSounds : narration.thinkingSounds
        };
      },
      get defaults() {
        const preferences = preferencesFor(conversation);
        return {
          ...conversation.defaults,
          readAloud: readAloudFor(conversation),
          ...(preferences.sendMode === "edit" ? { reviewBeforeSend: true } : {}),
          ...(preferences.voice ? {
            voiceId: preferences.voice === "current" ? "" : preferences.voice
          } : {})
        };
      },
      onReadAloudChange(value) {
        emit("read-aloud-change", value, { target: conversation.preferenceTarget, actorKey });
        return conversation.onReadAloudChange?.(value);
      },
      onPlayback(event) {
        emit("playback", event);
        return conversation.onPlayback?.(event);
      },
      get avatar() { return preferencesFor(conversation).avatar || conversation.avatar; }
    } });
  }
});
onScopeDispose(() => { void controller.dispose(); });
</script>
<template>
  <slot />
  <VoiceConversationHost v-if="controller.state.binding?.presentation !== 'inline' || controller.state.nextTarget" :controller="controller" :activator="launcher">
    <template #reopen />
    <template v-if="controller.state.binding?.setConversationTarget" #conversation="{ binding }">
      <div :ref="binding.setConversationTarget" class="vibe64-voice-host__conversation" />
    </template>
    <template v-if="$slots.settings" #settings="settings"><slot name="settings" v-bind="settings" :binding="controller.state.binding" /></template>
    <template v-if="$slots.avatar" #avatar="visual"><slot name="avatar" v-bind="visual" :binding="controller.state.binding" /></template>
  </VoiceConversationHost>
</template>

<style scoped>
.vibe64-voice-host__conversation { display: flex; flex: 1; min-width: 0; min-height: 0; }
</style>
