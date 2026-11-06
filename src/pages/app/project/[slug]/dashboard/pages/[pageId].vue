<template>
  <Vibe64PageViewer
    :page-id="pageId"
    :project-slug="projectSlug"
  />
</template>

<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import { Vibe64PageViewer } from "@local/vibe64-pages/client";
import { projectSlugFromRoute } from "@/lib/vibe64ProjectScope.js";

definePage({ meta: { jskit: { parent: "/project/:slug/dashboard/pages" } } });

const route = useRoute();
const projectSlug = computed(() => projectSlugFromRoute(route));
const pageId = computed(() => String(route.params.pageId || ""));
</script>
