<script setup>
// Colleague's recent operation receipts, each with the recovery its status allows.

defineProps({
  activator: { type: Object, default: undefined },
  fullscreen: Boolean,
  operations: { type: Array, required: true }
});
const emit = defineEmits(["open-target", "prepare-recovery"]);
const open = defineModel({ type: Boolean, default: false });
</script>

<template>
  <v-dialog v-model="open" :activator="activator" :open-on-click="false" :fullscreen="fullscreen" max-width="620" scrollable aria-label="Recent operations">
    <v-card>
      <v-card-title class="d-flex align-center text-title-large">
        <span class="flex-grow-1">Recent operations</span>
        <v-btn icon="$close" variant="text" aria-label="Close recent operations" title="Close recent operations" @click="open = false" />
      </v-card-title>
      <v-card-text class="vibe64-colleague__operation-details">
        <p>These receipts report what Vibe64 actually recorded. An uncertain receipt is not safe to repeat until its target is inspected.</p>
        <ol>
          <li v-for="item in operations" :key="item.id">
            <p><strong>{{ item.label }}</strong> · {{ item.status }}<span v-if="item.at"> · {{ item.at }}</span></p>
            <p v-if="item.target">{{ [item.target.projectSlug, item.target.sessionId, item.target.conversationId].filter(Boolean).join(' · ') }}</p>
            <p v-if="item.error" class="text-error">{{ item.error }}</p>
            <div class="d-flex flex-wrap ga-1">
              <v-btn v-if="item.target?.projectSlug" variant="text" min-height="48" @click="emit('open-target', item)">Open target</v-btn>
              <v-btn v-if="item.status === 'unknown'" variant="text" min-height="48" @click="emit('prepare-recovery', item)">Prepare inspection</v-btn>
              <v-btn v-else-if="item.status === 'failed' && item.canPrepareRetry" variant="text" min-height="48" @click="emit('prepare-recovery', item)">Prepare retry</v-btn>
            </div>
          </li>
        </ol>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>
