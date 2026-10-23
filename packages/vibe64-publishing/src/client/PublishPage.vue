<template>
  <v-card class="vibe64-publish-page" border flat rounded="lg">
    <v-empty-state
      :icon="mdiPackageVariantClosed"
      size="56"
      text="Publish turns your saved project into an app on your phone or a package people can install. Publishing targets will appear here."
      title="Nothing published yet"
    />
  </v-card>
</template>

<script setup>
import { mdiPackageVariantClosed } from "@mdi/js";
</script>

<style scoped>
.vibe64-publish-page {
  min-width: 0;
}

.vibe64-publish-page :deep(.v-empty-state__media .v-icon) {
  color: rgb(var(--v-theme-primary));
  opacity: 0.85;
}

.vibe64-publish-page :deep(.v-empty-state__text) {
  color: rgba(var(--v-theme-on-surface), 0.72);
  max-width: 34rem;
}
</style>
