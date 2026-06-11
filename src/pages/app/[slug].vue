<route lang="json">
{
  "meta": {
    "jskit": {
      "surface": "app"
    }
  }
}
</route>

<script setup>
import StudioAppShellLayout from "@/components/StudioAppShellLayout.vue";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RouterView, useRoute, useRouter } from "vue-router";
import {
  mdiApps,
  mdiChevronDown,
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
import Vibe64AccountMenu from "@/components/auth/Vibe64AccountMenu.vue";
import { readProjects } from "@/lib/vibe64ProjectApi.js";

const route = useRoute();
const router = useRouter();
const HOME_SHELL_CLASS = "studio-home-shell-active";
const pageTitle = ref("");
const pageError = ref("");
const chatCollapsed = ref(false);
const mobilePaneLayout = ref(false);
const projectLoadError = ref("");
const savedProjectTypeReady = ref(false);
const projects = ref([]);
let mobilePaneMediaQuery = null;
const projectSlug = computed(() => firstRouteParam(route.params.slug));
const projectSelectionResource = useEndpointResource({
  client: studioHttpClient,
  fallbackLoadError: "Project selection could not load.",
  path: PROJECT_SELECTION_ENDPOINT,
  queryKey: computed(() => projectSelectionQueryKey(VIBE64_SURFACE_ID, ROUTE_VISIBILITY_PUBLIC, projectSlug.value)),
  refreshOnPull: true
});
const targetRoot = computed(() => String(projectSelectionResource.data.value?.targetRoot || "").trim());
const targetFolderName = computed(() => projectSlug.value || finalPathSegment(targetRoot.value));
const developmentBasePath = computed(() => projectSlug.value ? `/app/${encodeURIComponent(projectSlug.value)}` : "/app/manage/projects");
const dashboardBasePath = computed(() => `${developmentBasePath.value}/dashboard`);
const dashboardRouteActive = computed(() => normalizedPath(route.path).startsWith(`${dashboardBasePath.value}/`));
const projectPane = computed(() => dashboardRouteActive.value ? "dashboard" : "preview");
const sortedProjects = computed(() => [...projects.value].sort((left, right) => left.slug.localeCompare(right.slug)));
const chatToggleIcon = computed(() => {
  if (mobilePaneLayout.value) {
    return chatCollapsed.value ? mdiChevronLeft : mdiChevronRight;
  }
  return chatCollapsed.value ? mdiChevronRight : mdiChevronLeft;
});
const chatToggleTitle = computed(() => {
  if (mobilePaneLayout.value) {
    return chatCollapsed.value ? "Show chat" : "Show project";
  }
  return chatCollapsed.value ? "Show chat" : "Collapse chat";
});
const projectTabs = Object.freeze([
  {
    id: "preview",
    label: "Preview"
  },
  {
    id: "dashboard",
    label: "Dashboard"
  }
]);
const mobileProjectAction = computed(() => (
  projectPane.value === "dashboard"
    ? {
        ariaLabel: "Go to preview",
        label: "Preview",
        pane: "preview"
      }
    : {
        ariaLabel: "Go to dashboard",
        label: "Dashboard",
        pane: "dashboard"
      }
));
const projectPaneNavigationVisible = computed(() => savedProjectTypeReady.value);
const mobileProjectActionVisible = computed(() => projectPaneNavigationVisible.value && mobilePaneLayout.value && chatCollapsed.value);

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

function firstRouteParam(value) {
  const rawValue = Array.isArray(value) ? value[0] : value;
  return String(rawValue || "").trim();
}

function normalizedPath(pathValue = "") {
  const path = String(pathValue || "").trim();
  if (!path || path === "/") {
    return path || "/";
  }
  return path.replace(/\/+$/u, "");
}

function setPageTitle(title = "") {
  pageTitle.value = String(title || "").trim();
}

function emitPageTitle(title = "") {
  setPageTitle(title);
}

function selectProjectPane(pane = "") {
  if (mobilePaneLayout.value) {
    setChatCollapsed(true);
  }
  if (pane === "dashboard") {
    void router.push(`${dashboardBasePath.value}/configure`);
    return;
  }
  void router.push(developmentBasePath.value);
}

async function loadProjects() {
  projectLoadError.value = "";
  try {
    const response = await readProjects();
    if (response.ok === false) {
      projectLoadError.value = String(response.errors?.[0]?.message || "Projects could not load.");
      projects.value = [];
      return;
    }
    projects.value = Array.isArray(response.projects) ? response.projects : [];
  } catch (error) {
    projectLoadError.value = String(error?.message || error || "Projects could not load.");
    projects.value = [];
  }
}

function openManagement() {
  void router.push("/app/manage/projects");
}

function openProject(project = {}) {
  const slug = String(project.slug || "").trim();
  if (!slug || slug === projectSlug.value) {
    return;
  }
  void router.push(`/app/${encodeURIComponent(slug)}`);
}

function showProjectPane() {
  if (mobilePaneLayout.value) {
    setChatCollapsed(true);
  }
}

function setChatCollapsed(collapsed = false) {
  chatCollapsed.value = Boolean(collapsed);
}

function syncMobilePaneLayout() {
  mobilePaneLayout.value = Boolean(mobilePaneMediaQuery?.matches);
}

function handleProjectTypeReady() {
  pageError.value = "";
  savedProjectTypeReady.value = true;
}

function handleProjectSelectionReady() {
  pageError.value = "";
  savedProjectTypeReady.value = false;
  emitPageTitle();
}

function handleProjectSelectionMissing() {
  pageError.value = "";
  savedProjectTypeReady.value = false;
  emitPageTitle("Choose project");
}

function handleProjectSelectionError(error) {
  pageError.value = String(error || "");
  savedProjectTypeReady.value = false;
  emitPageTitle();
}

function handleProjectTypeMissing(project = {}) {
  pageError.value = "";
  savedProjectTypeReady.value = project?.projectType?.ready === true;
  emitPageTitle(project?.projectType?.ready === true ? "Project setup" : "Choose project type");
}

function handleProjectTypeError(error) {
  pageError.value = String(error || "");
  savedProjectTypeReady.value = false;
  emitPageTitle();
}

watch(
  () => route.path,
  (path) => {
    if (normalizedPath(path) !== normalizedPath(developmentBasePath.value)) {
      setPageTitle();
    }
  },
  { immediate: true }
);

onMounted(() => {
  void loadProjects();
  setHomeShellActive(true);
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    mobilePaneMediaQuery = window.matchMedia("(max-width: 980px)");
    syncMobilePaneLayout();
    if (typeof mobilePaneMediaQuery.addEventListener === "function") {
      mobilePaneMediaQuery.addEventListener("change", syncMobilePaneLayout);
    } else {
      mobilePaneMediaQuery.addListener?.(syncMobilePaneLayout);
    }
  }
});

onBeforeUnmount(() => {
  setHomeShellActive(false);
  if (typeof mobilePaneMediaQuery?.removeEventListener === "function") {
    mobilePaneMediaQuery.removeEventListener("change", syncMobilePaneLayout);
  } else {
    mobilePaneMediaQuery?.removeListener?.(syncMobilePaneLayout);
  }
  mobilePaneMediaQuery = null;
});
</script>

<template>
  <StudioAppShellLayout>
    <template #top-left>
      <div
        class="studio-home-shell-heading"
        :class="{ 'studio-home-shell-heading--chat-collapsed': chatCollapsed }"
      >
        <div class="studio-home-shell-title-area">
          <v-menu location="bottom start">
            <template #activator="{ props: menuProps }">
              <v-btn
                class="studio-home-shell-project-selector"
                variant="text"
                v-bind="menuProps"
              >
                <span>{{ targetFolderName || "Project" }}</span>
                <v-icon :icon="mdiChevronDown" size="18" />
              </v-btn>
            </template>
            <v-list density="compact" min-width="240">
              <v-list-item
                :prepend-icon="mdiApps"
                title="Management"
                @click="openManagement"
              />
              <v-divider />
              <v-list-item
                v-for="project in sortedProjects"
                :key="project.slug"
                :active="project.slug === projectSlug"
                :title="project.slug"
                :subtitle="project.projectRoot"
                @click="openProject(project)"
              />
              <v-list-item
                v-if="sortedProjects.length === 0"
                :subtitle="projectLoadError || 'No projects found.'"
                title="Projects"
              />
            </v-list>
          </v-menu>
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

        <div class="studio-home-shell-project-controls">
          <v-btn
            class="studio-home-shell-chat-toggle"
            density="comfortable"
            :icon="chatToggleIcon"
            size="small"
            :title="chatToggleTitle"
            type="button"
            variant="tonal"
            :aria-label="chatToggleTitle"
            @click="setChatCollapsed(!chatCollapsed)"
          />

          <div
            v-if="projectPaneNavigationVisible"
            class="studio-home-shell-project-tabs studio-home-shell-project-tabs--desktop"
            role="tablist"
            aria-label="Project"
          >
            <button
              v-for="tab in projectTabs"
              :key="tab.id"
              class="studio-home-shell-project-tab"
              :class="{ 'studio-home-shell-project-tab--active': projectPane === tab.id }"
              role="tab"
              type="button"
              :aria-selected="projectPane === tab.id ? 'true' : 'false'"
              @click="selectProjectPane(tab.id)"
            >
              {{ tab.label }}
            </button>
          </div>
          <button
            v-if="mobileProjectActionVisible"
            class="studio-home-shell-project-mobile-action"
            type="button"
            :aria-label="mobileProjectAction.ariaLabel"
            @click="selectProjectPane(mobileProjectAction.pane)"
          >
            {{ mobileProjectAction.label }}
            <v-icon :icon="mdiChevronRight" size="15" />
          </button>
        </div>
      </div>
    </template>
    <template #top-right>
      <Vibe64AccountMenu />
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
          :key="projectSlug"
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
                  :project-pane="projectPane"
                  @title-change="emitPageTitle"
                  @project-attention="showProjectPane"
                  @project-pane-change="selectProjectPane"
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
  </StudioAppShellLayout>
</template>

<style scoped>
:global(body.studio-home-shell-active) {
  --studio-home-chat-column-min-width: 24rem;
  --studio-home-chat-column-width: 30rem;
  --studio-home-project-gap: 0.75rem;
  --studio-control-bg: #ffffff;
  --studio-control-rest-bg: #f7f7f8;
  --studio-control-active-bg: #e7e7e7;
  --studio-control-border: rgba(17, 24, 39, 0.12);
  --studio-control-border-strong: rgba(17, 24, 39, 0.18);
  --studio-control-text: #202124;
  --studio-control-muted-text: #5f6368;
  --studio-control-radius: 7px;
}

.generated-ui-screen {
  --generated-ui-screen-title-size: clamp(1.2rem, 1.7vw, 1.55rem);
  --generated-ui-screen-panel-padding: 0;
}

.studio-screen {
  flex: 1 1 auto;
  height: 100%;
  margin-inline: 0;
  max-width: none;
  min-height: 0;
  overflow: hidden;
  width: 100%;
}

.studio-screen__panel {
  padding: var(--generated-ui-screen-panel-padding);
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

.studio-screen__gate-scroll :deep(.project-type-setup),
.studio-screen__gate-scroll :deep(.project-config-setup) {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

.studio-home-shell-heading {
  align-items: center;
  display: grid;
  gap: var(--studio-home-project-gap);
  grid-template-columns: var(--studio-home-chat-column-width) auto;
  min-width: 0;
}

.studio-home-shell-heading--chat-collapsed {
  grid-template-columns: auto auto;
}

.studio-home-shell-title-area {
  align-items: center;
  display: flex;
  min-width: 0;
  padding-left: 1rem;
}

.studio-home-shell-project-selector {
  border-radius: 6px;
  color: rgb(var(--v-theme-on-surface)) !important;
  flex: 1 1 auto;
  font-size: 1rem;
  font-weight: 720;
  justify-content: start;
  letter-spacing: 0;
  line-height: 1.2;
  max-width: 100%;
  min-width: 0;
  padding-inline: 0.45rem;
  text-transform: none;
}

.studio-home-shell-project-selector :deep(.v-btn__content) {
  min-width: 0;
}

.studio-home-shell-project-selector span {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.studio-home-shell-title {
  color: rgb(var(--v-theme-on-surface));
  font-size: 1.2rem;
  flex: 1 1 auto;
  font-weight: 720;
  line-height: 1.2;
  margin: 0;
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.studio-home-shell-surface-label {
  color: rgb(var(--v-theme-on-surface));
  display: block;
  flex: 1 1 auto;
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
  flex: 1 1 auto;
  font-size: 1.2rem;
  font-weight: 760;
  line-height: 1.2;
  margin: 0;
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.studio-home-shell-project-controls {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  gap: 0.45rem;
  min-width: 0;
}

.studio-home-shell-chat-toggle {
  flex: 0 0 auto;
  background: var(--studio-control-rest-bg) !important;
  border: 1px solid transparent;
  box-shadow: none;
  color: var(--studio-control-text) !important;
  height: 2rem;
  min-height: 2rem;
  min-width: 2rem;
  width: 2rem;
}

.studio-home-shell-chat-toggle:hover {
  background: var(--studio-control-active-bg) !important;
}

.studio-home-shell-project-tabs {
  align-items: center;
  background: var(--studio-control-rest-bg);
  border: 1px solid var(--studio-control-border);
  border-radius: var(--studio-control-radius);
  display: inline-flex;
  flex: 0 0 auto;
  gap: 0.08rem;
  min-width: 0;
  padding: 0.1rem;
}

.studio-home-shell-project-tab {
  background: transparent;
  border: 0;
  border-radius: 5px;
  color: var(--studio-control-muted-text);
  cursor: pointer;
  flex: 0 0 auto;
  font: inherit;
  font-size: 0.92rem;
  font-weight: 500;
  letter-spacing: 0;
  line-height: 1.15;
  min-height: 1.75rem;
  padding: 0.24rem 0.78rem;
}

.studio-home-shell-project-tab:hover {
  color: var(--studio-control-text);
}

.studio-home-shell-project-tab--active {
  background: var(--studio-control-bg);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
  color: var(--studio-control-text);
  font-weight: 590;
}

.studio-home-shell-project-mobile-action {
  align-items: center;
  background: var(--studio-control-rest-bg);
  border: 1px solid var(--studio-control-border);
  border-radius: var(--studio-control-radius);
  color: var(--studio-control-text);
  cursor: pointer;
  display: none;
  flex: 0 0 auto;
  font: inherit;
  font-size: 0.88rem;
  font-weight: 590;
  gap: 0.2rem;
  justify-content: center;
  letter-spacing: 0;
  line-height: 1.15;
  min-height: 2rem;
  min-width: 4.25rem;
  padding: 0.28rem 0.62rem;
  white-space: nowrap;
}

.studio-home-shell-project-mobile-action:hover {
  background: var(--studio-control-active-bg);
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
  .studio-screen__gate-scroll :deep(.project-type-gate .studio-ai-sessions--autopilot) {
    padding: 0;
  }
}

@media (max-width: 980px) {
  .studio-home-shell-heading {
    gap: 0.5rem;
    grid-template-columns: minmax(0, 1fr) auto;
    width: 100%;
  }

  .studio-home-shell-project-controls {
    display: flex;
    margin-left: auto;
  }

  .studio-home-shell-project-tabs--desktop {
    display: none;
  }

  .studio-home-shell-project-mobile-action {
    display: inline-flex;
  }

  .studio-home-shell-project-tab {
    font-size: 0.86rem;
    padding-inline: 0.58rem;
  }
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

  .studio-home-shell-heading {
    display: flex;
    gap: 0.35rem;
    padding-left: 0.65rem;
    width: 100%;
  }

  .studio-home-shell-project-controls {
    gap: 0.28rem;
  }

  .studio-home-shell-project-tab {
    font-size: 0.78rem;
    min-height: 1.65rem;
    padding: 0.2rem 0.38rem;
  }

  .studio-home-shell-project-mobile-action {
    font-size: 0.82rem;
    min-height: 1.85rem;
    min-width: 3.85rem;
    padding: 0.22rem 0.5rem;
  }

  .studio-home-shell-title-area {
    padding-left: 0;
  }

  .studio-home-shell-project-selector {
    font-size: 0.95rem;
    max-width: calc(100vw - 16rem);
  }

  .studio-home-shell-actions {
    gap: 0.25rem;
    max-width: calc(100vw - 9rem);
  }

  .studio-home-shell-project-controls {
    gap: 0.3rem;
  }

  .studio-screen {
    max-width: 100%;
  }
}
</style>
