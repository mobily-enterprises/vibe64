<script setup>
import { computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  useVibe64ProjectsResource
} from "@/composables/useVibe64ProjectsResource.js";
import {
  projectAppPath
} from "@/lib/vibe64ProjectScope.js";

const route = useRoute();
const router = useRouter();
const projectSelection = useVibe64ProjectsResource({
  fallbackLoadError: "Project selection could not load.",
  requestRecoveryLabel: "Project selection"
});
const targetProjectSlug = computed(() => {
  const currentSlug = String(projectSelection.currentProject?.slug || "").trim();
  if (currentSlug) {
    return currentSlug;
  }
  const projects = Array.isArray(projectSelection.projects) ? projectSelection.projects : [];
  return String(projects[0]?.slug || "").trim();
});

watch(targetProjectSlug, (slug) => {
  if (!slug) {
    return;
  }
  void router.replace({
    path: projectAppPath(slug),
    query: route.query
  });
}, {
  immediate: true
});
</script>

<template>
  <span hidden />
</template>
