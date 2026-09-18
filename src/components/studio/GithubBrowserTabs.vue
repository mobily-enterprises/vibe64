<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import { mdiRecordCircleOutline, mdiSourcePull } from "@mdi/js";
import { projectAppPath, projectSlugFromRoute } from "@/lib/vibe64ProjectScope.js";

const route = useRoute();
const projectSlug = computed(() => projectSlugFromRoute(route));
const selected = computed(() => route.path.endsWith('/pull-requests') ? 'pull-requests' : 'issues');
</script>

<template>
  <v-tabs :model-value="selected" color="primary" density="compact" aria-label="Issues and pull requests">
    <v-tab
      value="issues" :prepend-icon="mdiRecordCircleOutline"
      :to="{ path: projectAppPath(projectSlug, '/dashboard/issues'), query: { ...route.query, issue: undefined } }"
    >
      Issues
    </v-tab>
    <v-tab
      value="pull-requests" :prepend-icon="mdiSourcePull"
      :to="{ path: projectAppPath(projectSlug, '/dashboard/pull-requests'), query: { ...route.query, pr: undefined, createPullRequest: undefined } }"
    >
      Pull requests
    </v-tab>
  </v-tabs>
</template>
