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
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RouterView, useRoute, useRouter } from "vue-router";
import {
  mdiChevronLeft,
  mdiChevronRight
} from "@mdi/js";
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
import ProjectSelectionGate from "@/components/studio/ProjectSelectionGate.vue";
import ProjectTypeGate from "@/components/studio/ProjectTypeGate.vue";
import Vibe64SessionPanel from "@/components/studio/Vibe64SessionPanel.vue";

const route = useRoute();
const router = useRouter();
const HOME_SHELL_CLASS = "studio-home-shell-active";
const pageTitle = ref("");
const pageError = ref("");
const chatCollapsed = ref(false);
const projectSelectionResource = useEndpointResource({
  client: studioHttpClient,
  fallbackLoadError: "Project selection could not load.",
  path: PROJECT_SELECTION_ENDPOINT,
  queryKey: computed(() => projectSelectionQueryKey(VIBE64_SURFACE_ID, ROUTE_VISIBILITY_PUBLIC)),
  refreshOnPull: true
});
const targetRoot = computed(() => String(projectSelectionResource.data.value?.targetRoot || "").trim());
const targetFolderName = computed(() => finalPathSegment(targetRoot.value));
const dashboardRouteActive = computed(() => String(route.path || "").startsWith("/home/dashboard"));
const workspacePane = computed(() => dashboardRouteActive.value ? "dashboard" : "preview");
const workspaceTabs = Object.freeze([
  {
    id: "preview",
    label: "Preview"
  },
  {
    id: "dashboard",
    label: "Dashboard"
  }
]);

useStudioShellDrawer({
  hidden: true
});

function setHomeShellActive(active) {
  if (typeof document === "undefined") {
    return;
  }
  document.body.classList.toggle(HOME_SHELL_CLASS, Boolean(active));
}

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

function emitPageTitle(title = "") {
  setPageTitle(title);
}

function selectWorkspacePane(pane = "") {
  if (pane === "dashboard") {
    void router.push("/home/dashboard/accounts");
    return;
  }
  void router.push("/home");
}

function toggleChatCollapsed() {
  chatCollapsed.value = !chatCollapsed.value;
}

function handleProjectTypeReady() {
  pageError.value = "";
}

function handleProjectSelectionReady() {
  pageError.value = "";
  emitPageTitle();
}

function handleProjectSelectionMissing() {
  pageError.value = "";
  emitPageTitle("Choose project");
}

function handleProjectSelectionError(error) {
  pageError.value = String(error || "");
  emitPageTitle();
}

function handleProjectTypeMissing(project = {}) {
  pageError.value = "";
  emitPageTitle(project?.projectType?.ready === true ? "Configure project" : "Choose project type");
}

function handleProjectTypeError(error) {
  pageError.value = String(error || "");
  emitPageTitle();
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

onMounted(() => {
  setHomeShellActive(true);
});

onBeforeUnmount(() => {
  setHomeShellActive(false);
});
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

        <div
          class="studio-home-shell-workspace-tabs"
          role="tablist"
          aria-label="Workspace"
        >
          <button
            v-for="tab in workspaceTabs"
            :key="tab.id"
            class="studio-home-shell-workspace-tab"
            :class="{ 'studio-home-shell-workspace-tab--active': workspacePane === tab.id }"
            role="tab"
            type="button"
            :aria-selected="workspacePane === tab.id ? 'true' : 'false'"
            @click="selectWorkspacePane(tab.id)"
          >
            {{ tab.label }}
          </button>
        </div>

        <v-btn
          class="studio-home-shell-chat-toggle"
          density="comfortable"
          :icon="chatCollapsed ? mdiChevronRight : mdiChevronLeft"
          size="small"
          :title="chatCollapsed ? 'Show chat' : 'Collapse chat'"
          type="button"
          variant="tonal"
          :aria-label="chatCollapsed ? 'Show chat' : 'Collapse chat'"
          @click="toggleChatCollapsed"
        />
      </div>
    </template>
    <section class="generated-ui-screen generated-ui-screen--studio studio-screen d-flex flex-column ga-3">
      <v-alert
        v-if="pageError"
        type="error"
        variant="tonal"
        border="start"
        class="studio-screen__alert"
      >
        {{ pageError }}
      </v-alert>

      <div class="studio-screen__gate-scroll">
        <ProjectSelectionGate
          @error="handleProjectSelectionError"
          @missing="handleProjectSelectionMissing"
          @ready="handleProjectSelectionReady"
        >
          <template #default>
            <ProjectTypeGate
              @error="handleProjectTypeError"
              @missing="handleProjectTypeMissing"
              @ready="handleProjectTypeReady"
            >
              <template #default="projectGateSlotProps">
                <Vibe64SessionPanel
                  :chat-collapsed="chatCollapsed"
                  :workspace-pane="workspacePane"
                  @title-change="emitPageTitle"
                >
                  <template #dashboard="dashboardSlotProps">
                    <RouterView
                      v-if="dashboardRouteActive"
                      :dashboard-context="dashboardSlotProps?.dashboardContext || {}"
                      :project-context="projectGateSlotProps?.targetProject || {}"
                      :save-project-config="projectGateSlotProps?.saveProjectConfig"
                      :saving-project-config="projectGateSlotProps?.savingConfig === true"
                    />
                  </template>
                </Vibe64SessionPanel>
              </template>
            </ProjectTypeGate>
          </template>
        </ProjectSelectionGate>
      </div>
    </section>
  </ShellLayout>
</template>

<style scoped>
.generated-ui-screen {
  --generated-ui-screen-title-size: clamp(1.2rem, 1.7vw, 1.55rem);
  --generated-ui-screen-panel-padding: 0;
}

.studio-screen {
  margin-inline: 0;
  max-width: none;
  min-height: 0;
  width: 100%;
}

.studio-screen__panel {
  padding: var(--generated-ui-screen-panel-padding);
}

.studio-home-shell-heading {
  align-items: center;
  display: flex;
  gap: 0.8rem;
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
  max-width: min(30rem, 36vw);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.studio-home-shell-workspace-tabs {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  gap: 0.18rem;
  min-width: 0;
}

.studio-home-shell-workspace-tab {
  background: transparent;
  border: 0;
  border-radius: 999px;
  color: rgba(var(--v-theme-on-surface), 0.72);
  cursor: pointer;
  font: inherit;
  font-size: 0.92rem;
  font-weight: 720;
  letter-spacing: 0;
  line-height: 1.15;
  min-height: 2rem;
  padding: 0.34rem 0.78rem;
}

.studio-home-shell-workspace-tab:hover {
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-on-surface));
}

.studio-home-shell-workspace-tab--active {
  background: rgba(var(--v-theme-primary), 0.13);
  color: rgb(var(--v-theme-primary));
}

.studio-home-shell-chat-toggle {
  flex: 0 0 auto;
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

@media (min-width: 981px) {
  .studio-screen {
    flex: 1 1 auto;
    height: 100%;
    overflow: hidden;
  }

  .studio-screen__gate-scroll {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }

  .studio-screen__gate-scroll :deep(.project-type-gate),
  .studio-screen__gate-scroll :deep(.project-selection-gate) {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-height: 0;
  }

  .studio-screen__gate-scroll :deep(.project-type-gate .studio-ai-sessions) {
    flex: 1 1 auto;
    min-height: 0;
  }

  .studio-screen__gate-scroll :deep(.project-type-gate .studio-ai-sessions--autopilot) {
    padding: 0;
  }

  .studio-screen__gate-scroll :deep(.project-type-setup),
  .studio-screen__gate-scroll :deep(.project-config-setup) {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
  }
}

@media (max-width: 600px) {
  .studio-home-shell-title {
    font-size: 1.05rem;
    max-width: calc(100vw - 14rem);
  }

  .studio-home-shell-target-folder {
    font-size: 1.05rem;
    max-width: calc(100vw - 17rem);
  }

  .studio-home-shell-heading {
    gap: 0.35rem;
    padding-left: 0.35rem;
  }

  .studio-home-shell-workspace-tab {
    font-size: 0.82rem;
    min-height: 1.8rem;
    padding-inline: 0.46rem;
  }

  .studio-home-shell-actions {
    gap: 0.25rem;
    max-width: calc(100vw - 9rem);
  }

  .studio-screen {
    max-width: 100%;
  }
}
</style>
