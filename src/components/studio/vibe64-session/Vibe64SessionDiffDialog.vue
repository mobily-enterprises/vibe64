<template>
  <v-dialog
    :model-value="diff.open"
    max-width="min(94vw, 72rem)"
    @update:model-value="updateOpen"
  >
    <v-card class="studio-ai-session-diff-dialog">
      <v-card-title class="studio-ai-session-diff-dialog__title">
        <span>Review changes</span>
        <v-chip
          v-if="diff.payload"
          :color="diff.payload.hasChanges ? 'primary' : 'default'"
          size="small"
          variant="tonal"
        >
          {{ diff.payload.hasChanges ? "Changes found" : "No changes" }}
        </v-chip>
      </v-card-title>

      <v-card-text
        class="studio-ai-session-diff-dialog__body"
      >
        <Vibe64SessionDiffContent :diff="diff" />
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="diff.close">Close</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
import Vibe64SessionDiffContent from "@/components/studio/vibe64-session/Vibe64SessionDiffContent.vue";

const props = defineProps({
  diff: {
    default: () => ({}),
    type: Object
  }
});

function updateOpen(open) {
  if (open !== true) {
    props.diff.close();
  }
}
</script>

<style scoped>
.studio-ai-session-diff-dialog {
  max-height: 90vh;
}

.studio-ai-session-diff-dialog__title {
  align-items: center;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
}

.studio-ai-session-diff-dialog__body {
  max-height: 72vh;
  overflow-x: hidden;
  overflow-y: auto;
}

</style>
