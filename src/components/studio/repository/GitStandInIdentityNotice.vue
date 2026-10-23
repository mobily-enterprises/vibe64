<template>
  <v-alert
    class="git-stand-in"
    type="info"
    variant="tonal"
    title="Saved with a stand-in name"
    closable
    @click:close="emit('close')"
  >
    <p class="mt-1 mb-3">
      Git doesn’t know your name and email yet, so this Save is marked “via Vibe64”.
      To use yours from now on, run this once in a terminal:
    </p>
    <Vibe64CopyCommand :command="GIT_IDENTITY_COMMANDS" label="Copy both commands" />
  </v-alert>
</template>

<script setup>
// Shown after a Save whose commit used the stand-in Git identity.
import Vibe64CopyCommand from "@/components/common/Vibe64CopyCommand.vue";
import { GIT_IDENTITY_COMMANDS } from "@/lib/gitIdentityCommands.js";

const emit = defineEmits(["close"]);
</script>
