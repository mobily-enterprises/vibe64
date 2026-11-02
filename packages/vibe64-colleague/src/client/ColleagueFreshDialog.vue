<script setup>
// Confirms starting a fresh Colleague conversation, or retrying the pending fresh operation.
defineProps({
  open: Boolean,
  busy: Boolean,
  blocked: { type: String, default: "" },
  error: { type: String, default: "" },
  resuming: Boolean
});
const emit = defineEmits(["close", "start"]);
</script>

<template>
  <v-dialog :model-value="open" max-width="520" :persistent="busy" @update:model-value="value => !value && emit('close')">
    <v-card title="Start a fresh conversation?">
      <v-card-text>
        <p>This ends the old voice conversation. Nothing will be resent. Its history and any unconfirmed words remain available in Previous conversations. Watches and assignments continue.</p>
        <p>Your typed draft and personal microphone, speaker, avatar and voice preferences stay. The new conversation does not automatically start voice.</p>
        <p v-if="blocked" role="status">{{ blocked }}</p>
        <p v-if="error" role="alert">{{ error }}</p>
      </v-card-text>
      <v-card-actions>
        <v-btn :disabled="busy" @click="emit('close')">{{ resuming ? 'Close' : 'Cancel' }}</v-btn>
        <v-btn :disabled="busy || Boolean(blocked)" color="primary" @click="emit('start')">{{ busy ? 'Checking fresh conversation…' : resuming ? 'Retry same fresh operation' : 'Start fresh' }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
