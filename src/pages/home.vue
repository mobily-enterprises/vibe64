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
  VIBE64_SURFACE_ID
} from "@/lib/vibe64RequestConfig.js";
import {
  PROJECT_SELECTION_ENDPOINT,
  projectSelectionQueryKey
} from "@/lib/studioGateApi.js";
import {
  studioHttpClient
} from "@/lib/studioHttp.js";
import { useStudioShellDrawer } from "@/composables/useStudioShellDrawer.js";
import Vibe64HomeWorkspaceMenu from "@/components/studio/Vibe64HomeWorkspaceMenu.vue";

const route = useRoute();
const pageTitle = ref("");
const projectSelectionResource = useEndpointResource({
  client: studioHttpClient,
  fallbackLoadError: "Project selection could not load.",
  path: PROJECT_SELECTION_ENDPOINT,
  queryKey: computed(() => projectSelectionQueryKey(VIBE64_SURFACE_ID, ROUTE_VISIBILITY_PUBLIC)),
  refreshOnPull: true
});
const targetRoot = computed(() => String(projectSelectionResource.data.value?.targetRoot || "").trim());
const targetFolderName = computed(() => finalPathSegment(targetRoot.value));

useStudioShellDrawer({
  hidden: true
});

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
    <template #top-right>
      <div
        id="studio-home-app-bar-actions"
        class="studio-home-shell-actions"
      >
        <Vibe64HomeWorkspaceMenu />
      </div>
    </template>
    <RouterView @page-title-change="setPageTitle" />
  </ShellLayout>
</template>

<style scoped>
.studio-home-shell-heading {
  align-items: center;
  display: flex;
  gap: 0.45rem;
  min-width: 0;
  padding-left: 1rem;
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

.studio-home-shell-actions {
  align-items: center;
  display: flex;
  gap: 0.35rem;
  justify-content: flex-end;
  margin-left: auto;
  max-width: min(48rem, 72vw);
  min-width: 0;
  white-space: nowrap;
}

@media (max-width: 600px) {
  .studio-home-shell-title {
    font-size: 1.05rem;
    max-width: calc(100vw - 14rem);
  }

  .studio-home-shell-target-folder {
    font-size: 1.05rem;
    max-width: calc(100vw - 16rem);
  }

  .studio-home-shell-actions {
    gap: 0.25rem;
    max-width: calc(100vw - 9rem);
  }
}
</style>
