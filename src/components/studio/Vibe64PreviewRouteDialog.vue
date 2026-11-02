<template>
  <v-dialog
    v-model="previewRouteDialogVisible"
    max-width="520"
  >
    <v-card class="vibe64-launch-controls__route-card">
      <v-card-title>{{ previewRouteSelection?.label || "Preview page" }}</v-card-title>

      <v-card-text>
        <v-text-field
          density="compact"
          label="URL"
          :model-value="previewRouteDialogPath"
          readonly
          variant="outlined"
        />

        <v-text-field
          v-for="param in previewRouteDialogParams"
          :key="param.name"
          v-model="previewRouteFormValues[param.name]"
          density="comfortable"
          :hint="param.description"
          :label="param.label"
          :placeholder="param.placeholder"
          :persistent-hint="Boolean(param.description)"
          variant="outlined"
          @keydown.enter.prevent="submitPreviewRouteDialog"
        />

        <v-alert
          v-if="previewRouteDialogError"
          density="compact"
          type="warning"
          variant="tonal"
        >
          {{ previewRouteDialogError }}
        </v-alert>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          @click="previewRouteDialogVisible = false"
        >
          Cancel
        </v-btn>
        <v-btn
          color="primary"
          variant="flat"
          @click="submitPreviewRouteDialog"
        >
          Open
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
// The parameters of a Preview page route before it opens.
const props = defineProps({
  surface: {
    required: true,
    type: /** @type {import("vue").PropType<ReturnType<typeof import("@/composables/useVibe64OutputControlsSurface.js").useVibe64OutputControlsSurface>>} */ (Object)
  }
});

const {
  previewRouteDialogError,
  previewRouteDialogParams,
  previewRouteDialogPath,
  previewRouteDialogVisible,
  previewRouteFormValues,
  previewRouteSelection,
  submitPreviewRouteDialog
} = props.surface;
</script>

<style scoped>
.vibe64-launch-controls__route-card :deep(.v-card-text) {
  display: grid;
  gap: 0.75rem;
}
</style>
