<template>
  <Vibe64SessionInputDialog
    :input="dialogs.input"
    @update-values="emit('update-input-values', $event)"
  />

  <Vibe64SessionDiffDialog
    v-if="dialogs.diff?.open"
    :diff="dialogs.diff"
  />

  <Vibe64SessionAbandonDialog
    :abandon="dialogs.abandon"
    :short-session-id="shortSessionId"
  />
</template>

<script setup>
import Vibe64SessionAbandonDialog from "@/components/studio/vibe64-session/Vibe64SessionAbandonDialog.vue";
import Vibe64SessionInputDialog from "@/components/studio/vibe64-session/Vibe64SessionInputDialog.vue";
import {
  defineVibe64AsyncComponent
} from "@/lib/vibe64AsyncComponent.js";

const Vibe64SessionDiffDialog = defineVibe64AsyncComponent({
  label: "Diff dialog",
  loader: () => import("@/components/studio/vibe64-session/Vibe64SessionDiffDialog.vue"),
  minHeight: "12rem"
});

defineProps({
  dialogs: {
    default: () => ({}),
    type: Object
  },
  shortSessionId: {
    default: (sessionId) => String(sessionId || ""),
    type: Function
  }
});

const emit = defineEmits([
  "update-input-values"
]);
</script>
