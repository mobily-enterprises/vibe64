<route lang="json">
{
  "meta": {
    "jskit": {
      "surface": "home"
    }
  }
}
</route>

<script setup>
import ShellLayout from "@/components/ShellLayout.vue";
import { computed, ref, watch } from "vue";
import { RouterView, useRoute } from "vue-router";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";
import {
  AI_STUDIO_SURFACE_ID
} from "@/lib/aiStudioRequestConfig.js";
import {
  PROJECT_TYPE_ENDPOINT,
  projectTypeQueryKey
} from "@/lib/studioGateApi.js";
import {
  studioHttpClient
} from "@/lib/studioHttp.js";

const route = useRoute();
const pageTitle = ref("");
const projectTypeResource = useEndpointResource({
  client: studioHttpClient,
  fallbackLoadError: "Project type could not load.",
  path: PROJECT_TYPE_ENDPOINT,
  queryKey: computed(() => projectTypeQueryKey(AI_STUDIO_SURFACE_ID, ROUTE_VISIBILITY_PUBLIC)),
  refreshOnPull: true
});
const targetRoot = computed(() => String(projectTypeResource.data.value?.projectType?.targetRoot || "").trim());
const targetFolderName = computed(() => finalPathSegment(targetRoot.value));

function finalPathSegment(pathValue = "") {
  const normalizedPath = String(pathValue || "").trim().replace(/[\\/]+$/u, "");
  if (!normalizedPath) {
    return "";
  }
  return normalizedPath.split(/[\\/]+/u).filter(Boolean).at(-1) || "";
}

function setPageTitle(title = "") {
  pageTitle.value = String(title || "").trim();
}

watch(
  () => route.path,
  (path) => {
    if (path !== "/home" && path !== "/home/") {
      setPageTitle();
    }
  },
  { immediate: true }
);
</script>

<template>
  <ShellLayout>
    <template #top-left>
      <div class="studio-home-shell-heading">
        <h1
          v-if="targetFolderName"
          class="studio-home-shell-target-folder"
          :title="targetRoot"
        >
          {{ targetFolderName }}
        </h1>
        <!--
        <h1
          v-if="pageTitle"
          class="studio-home-shell-title"
          :title="pageTitle"
          aria-live="polite"
        >
          {{ pageTitle }}
        </h1>
        <span v-else class="studio-home-shell-surface-label">
          Sessions
        </span>
        -->
      </div>
    </template>
    <RouterView v-slot="{ Component }">
      <component
        :is="Component"
        @page-title-change="setPageTitle"
      />
    </RouterView>
  </ShellLayout>
</template>

<style scoped>
.studio-home-shell-heading {
  align-items: center;
  display: flex;
  gap: 0.45rem;
  min-width: 0;
}

.studio-home-shell-title {
  color: rgb(var(--v-theme-on-surface));
  font-size: 1.2rem;
  flex: 0 1 auto;
  font-weight: 720;
  line-height: 1.2;
  margin: 0;
  max-width: min(44rem, 58vw);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.studio-home-shell-surface-label {
  color: rgb(var(--v-theme-on-surface));
  display: block;
  flex: 0 1 auto;
  font-size: 0.95rem;
  font-weight: 650;
  line-height: 1.2;
  max-width: 12rem;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.studio-home-shell-target-folder {
  color: rgb(var(--v-theme-on-surface));
  display: block;
  flex: 0 1 auto;
  font-size: 1.2rem;
  font-weight: 760;
  line-height: 1.2;
  margin: 0;
  max-width: min(44rem, 58vw);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 600px) {
  .studio-home-shell-title {
    font-size: 1.05rem;
    max-width: calc(100vw - 14rem);
  }

  .studio-home-shell-target-folder {
    font-size: 1.05rem;
    max-width: calc(100vw - 8.5rem);
  }
}
</style>
