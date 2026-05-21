<template>
  <section class="studio-report-preview" :aria-label="title">
    <div class="studio-report-preview__header">
      <strong>{{ title }}</strong>
      <v-progress-circular
        v-if="loading"
        color="primary"
        indeterminate
        size="18"
        width="2"
      />
    </div>

    <v-alert
      v-if="error"
      density="compact"
      type="warning"
      variant="tonal"
    >
      {{ error }}
    </v-alert>

    <pre v-else class="studio-report-preview__body">{{ text || emptyText }}</pre>
  </section>
</template>

<script setup>
defineProps({
  emptyText: {
    default: "Report is not ready yet.",
    type: String
  },
  error: {
    default: "",
    type: String
  },
  loading: {
    default: false,
    type: Boolean
  },
  text: {
    default: "",
    type: String
  },
  title: {
    default: "Session report",
    type: String
  }
});
</script>

<style scoped>
.studio-report-preview {
  border: 1px solid rgba(var(--v-theme-outline), 0.24);
  border-radius: 8px;
  display: grid;
  gap: 0.55rem;
  padding: 0.75rem;
  text-align: left;
}

.studio-report-preview__header {
  align-items: center;
  display: flex;
  gap: 0.5rem;
  justify-content: space-between;
}

.studio-report-preview__body {
  color: rgb(var(--v-theme-on-surface));
  font-family: inherit;
  font-size: 0.86rem;
  line-height: 1.45;
  margin: 0;
  max-height: 18rem;
  overflow: auto;
  white-space: pre-wrap;
}
</style>
