<template>
  <section class="vibe64-dashboard-page">
    <Vibe64DashboardPageHeader
      description="Release your project as an app or a package people can install."
      :icon="mdiPackageVariantClosed"
      title="Publish"
    />
    <PublishPage />
  </section>
</template>

<script setup>
import { mdiPackageVariantClosed } from "@mdi/js";
import PublishPage from "@local/vibe64-publishing/client/publish-page";
import Vibe64DashboardPageHeader from "@/components/studio/Vibe64DashboardPageHeader.vue";
</script>

<style scoped>
.vibe64-dashboard-page {
  display: grid;
  gap: 0.75rem;
  margin-inline: auto;
  max-width: 68rem;
  min-width: 0;
  width: 100%;
}
</style>
