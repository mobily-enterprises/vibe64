<template>
  <section class="vibe64-dashboard-page">
    <Vibe64DashboardPageHeader
      description="Files every session in this project can use: drop files here to share them, and keep backups."
      :icon="mdiFolderMultipleOutline"
      title="Project files"
    />
    <Vibe64ProjectFiles :project-slug="projectSlug" />
  </section>
</template>

<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import { mdiFolderMultipleOutline } from "@mdi/js";
import { projectSlugFromRoute } from "@/lib/vibe64ProjectScope.js";
import Vibe64DashboardPageHeader from "@/components/studio/Vibe64DashboardPageHeader.vue";
import Vibe64ProjectFiles from "@/components/studio/files/Vibe64ProjectFiles.vue";

const route = useRoute();
const projectSlug = computed(() => projectSlugFromRoute(route));
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
