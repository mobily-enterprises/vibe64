<template>
  <section class="vibe64-dashboard-page">
    <Vibe64DashboardPageHeader
      description="Pages the AI made for this project. Everyone with access to the project can open them."
      icon="$fileCopy"
      title="Pages"
    />
    <Vibe64PagesList :project-slug="projectSlug" />
  </section>
</template>

<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import { Vibe64PagesList } from "@local/vibe64-pages/client";
import { projectSlugFromRoute } from "@/lib/vibe64ProjectScope.js";
import Vibe64DashboardPageHeader from "@/components/studio/Vibe64DashboardPageHeader.vue";

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
