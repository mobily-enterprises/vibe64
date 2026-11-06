<template>
  <Vibe64PageViewer
    :page-id="pageId"
    :pages-path="projectAppPath(projectSlug, '/dashboard/pages')"
    :project-slug="projectSlug"
  />
</template>

<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import { Vibe64PageViewer } from "@local/vibe64-pages/client";
import { projectAppPath, projectSlugFromRoute } from "@/lib/vibe64ProjectScope.js";

const route = useRoute();
const projectSlug = computed(() => projectSlugFromRoute(route));
const pageId = computed(() => String(route.params.pageId || ""));
</script>
