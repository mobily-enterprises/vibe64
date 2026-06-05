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
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import {
  mdiArrowRight,
  mdiPlus
} from "@mdi/js";
import ShellLayout from "@/components/ShellLayout.vue";
import Vibe64AccountMenu from "@/components/auth/Vibe64AccountMenu.vue";
import Vibe64UserManagement from "@/components/auth/Vibe64UserManagement.vue";
import AIAccountsSetup from "@/components/studio/AIAccountsSetup.vue";
import StudioSetupDoctorScreen from "@/components/studio/StudioSetupDoctorScreen.vue";
import { useStudioShellDrawer } from "@/composables/useStudioShellDrawer.js";
import {
  createWorkspace,
  readWorkspaces
} from "@/lib/vibe64WorkspaceApi.js";

const router = useRouter();
const loading = ref(true);
const saving = ref(false);
const loadError = ref("");
const formError = ref("");
const projectsRoot = ref("");
const slug = ref("");
const workspaces = ref([]);
const activeManagementView = ref("workspaces");
const sortedWorkspaces = computed(() => [...workspaces.value].sort((left, right) => left.slug.localeCompare(right.slug)));
const slugHint = computed(() => slug.value.trim() ? "Lowercase letters, numbers, dashes, and underscores." : "");
const managementViews = Object.freeze([
  {
    label: "Workspaces",
    value: "workspaces"
  },
  {
    label: "Studio setup",
    value: "studio-setup"
  },
  {
    label: "AI Accounts",
    value: "accounts"
  },
  {
    label: "Users",
    value: "users"
  }
]);

useStudioShellDrawer({
  hidden: true
});

onMounted(() => {
  void loadWorkspaces();
});

async function loadWorkspaces() {
  loading.value = true;
  loadError.value = "";
  try {
    applyWorkspaceState(await readWorkspaces());
  } catch (error) {
    loadError.value = String(error?.message || error || "Workspaces could not load.");
  } finally {
    loading.value = false;
  }
}

async function submitWorkspace() {
  saving.value = true;
  formError.value = "";
  try {
    const response = await createWorkspace({
      slug: slug.value
    });
    if (response.ok === false) {
      formError.value = workspaceError(response);
      return;
    }
    slug.value = "";
    await loadWorkspaces();
  } catch (error) {
    formError.value = String(error?.message || error || "Workspace could not be created.");
  } finally {
    saving.value = false;
  }
}

function applyWorkspaceState(response = {}) {
  if (response.ok === false) {
    loadError.value = workspaceError(response);
    return;
  }
  projectsRoot.value = String(response.projectsRoot || "");
  workspaces.value = Array.isArray(response.workspaces) ? response.workspaces : [];
}

function workspaceError(response = {}) {
  return String(response.errors?.[0]?.message || response.error || "Vibe64 workspace request failed.");
}

function openWorkspace(workspace = {}) {
  const workspaceSlug = String(workspace.slug || "").trim();
  if (!workspaceSlug) {
    return;
  }
  void router.push(`/app/${workspaceSlug}`);
}

function viewTabId(value) {
  return `manage-tab-${value}`;
}

function viewPanelId(value) {
  return `manage-panel-${value}`;
}
</script>

<template>
  <ShellLayout>
    <template #top-left>
      <h1 class="vibe64-manage__title">Vibe64</h1>
    </template>
    <template #top-right>
      <Vibe64AccountMenu />
    </template>

    <main class="vibe64-manage">
      <section class="vibe64-manage__bar">
        <div class="vibe64-manage__heading">
          <h2>Management</h2>
          <p v-if="projectsRoot" :title="projectsRoot">
            {{ projectsRoot }}
          </p>
        </div>

        <form
          v-if="activeManagementView === 'workspaces'"
          class="vibe64-manage__create"
          @submit.prevent="submitWorkspace"
        >
          <v-text-field
            v-model="slug"
            autocomplete="off"
            density="compact"
            :error-messages="formError"
            :hint="slugHint"
            label="New slug"
            persistent-hint
            required
            variant="outlined"
          />
          <v-btn
            color="primary"
            :disabled="!slug.trim()"
            :loading="saving"
            size="small"
            type="submit"
            variant="flat"
          >
            <v-icon :icon="mdiPlus" />
            Create
          </v-btn>
        </form>
      </section>

      <nav class="vibe64-manage__tabs">
        <v-tabs
          v-model="activeManagementView"
          aria-label="Management views"
          color="primary"
          density="comfortable"
          show-arrows
        >
          <v-tab
            v-for="view in managementViews"
            :id="viewTabId(view.value)"
            :key="view.value"
            :aria-controls="viewPanelId(view.value)"
            :value="view.value"
          >
            {{ view.label }}
          </v-tab>
        </v-tabs>
      </nav>

      <section
        :id="viewPanelId(activeManagementView)"
        class="vibe64-manage__panel"
        role="tabpanel"
        tabindex="0"
        :aria-labelledby="viewTabId(activeManagementView)"
      >
        <template v-if="activeManagementView === 'workspaces'">
          <v-alert v-if="loadError" type="error" variant="tonal">
            {{ loadError }}
          </v-alert>

          <div v-if="loading" class="vibe64-manage__loading">
            <v-progress-circular color="primary" indeterminate />
          </div>

          <section v-else class="vibe64-manage__list" aria-label="Workspaces">
            <button
              v-for="workspace in sortedWorkspaces"
              :key="workspace.slug"
              class="vibe64-manage__workspace"
              type="button"
              @click="openWorkspace(workspace)"
            >
              <span>
                <strong>{{ workspace.slug }}</strong>
                <small>{{ workspace.workspaceRoot }}</small>
              </span>
              <v-icon :icon="mdiArrowRight" />
            </button>
            <p v-if="sortedWorkspaces.length === 0" class="vibe64-manage__empty">
              No workspaces yet.
            </p>
          </section>
        </template>

        <StudioSetupDoctorScreen
          v-else-if="activeManagementView === 'studio-setup'"
          :continue-enabled="false"
        />

        <AIAccountsSetup
          v-else-if="activeManagementView === 'accounts'"
          :show-continue="false"
        />

        <Vibe64UserManagement v-else />
      </section>
    </main>
  </ShellLayout>
</template>

<style scoped>
.vibe64-manage {
  align-content: start;
  background: #f6f7f9;
  color: #111827;
  display: grid;
  gap: 0.85rem;
  grid-template-rows: auto auto minmax(0, 1fr);
  min-height: calc(100dvh - var(--v-layout-top, 0px));
  padding: 1rem clamp(1rem, 2vw, 2rem);
}

.vibe64-manage__title {
  font-size: 1.15rem;
  font-weight: 720;
  line-height: 1.2;
  margin: 0 0 0 1rem;
}

.vibe64-manage__bar,
.vibe64-manage__tabs,
.vibe64-manage__panel {
  margin-inline: auto;
  max-width: 82rem;
  width: 100%;
}

.vibe64-manage__bar {
  align-items: start;
  display: grid;
  gap: 1rem;
  grid-template-columns: minmax(0, 1fr) minmax(18rem, 25rem);
}

.vibe64-manage__heading h2 {
  font-size: 1.4rem;
  font-weight: 720;
  line-height: 1.2;
  margin: 0;
}

.vibe64-manage__heading p {
  color: #64748b;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.82rem;
  line-height: 1.4;
  margin: 0.35rem 0 0;
  max-width: 100%;
  overflow-wrap: anywhere;
}

.vibe64-manage__create {
  align-items: start;
  display: grid;
  gap: 0.65rem;
  grid-template-columns: minmax(0, 1fr) auto;
}

.vibe64-manage__tabs {
  border-bottom: 1px solid rgba(15, 23, 42, 0.1);
}

.vibe64-manage__tabs :deep(.v-tab) {
  letter-spacing: 0;
  min-height: 42px;
  text-transform: none;
}

.vibe64-manage__panel {
  align-content: start;
  display: grid;
  gap: 0.8rem;
  min-height: 0;
  min-width: 0;
}

.vibe64-manage__loading {
  align-items: center;
  display: flex;
  justify-content: center;
  min-height: 14rem;
}

.vibe64-manage__list {
  align-content: start;
  display: grid;
  gap: 0.6rem;
  grid-auto-rows: minmax(3.6rem, auto);
}

.vibe64-manage__panel :deep(.vibe64-account-settings) {
  margin: 0;
  max-width: none;
  padding: 0;
}

.vibe64-manage__panel :deep(.accounts-setup) {
  margin: 0;
  max-width: none;
  padding: 0;
}

.vibe64-manage__panel :deep(.generated-ui-screen) {
  background: transparent;
  min-height: 0;
  padding: 0;
}

.vibe64-manage__panel :deep(.studio-screen__header),
.vibe64-manage__panel :deep(.doctor-status__quiet),
.vibe64-manage__panel :deep(.doctor-status),
.vibe64-manage__panel :deep(.accounts-setup__header),
.vibe64-manage__panel :deep(.accounts-setup__items) {
  margin-inline: auto;
  max-width: 54rem;
  width: 100%;
}

.vibe64-manage__workspace {
  align-items: center;
  background: #ffffff;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 8px;
  color: inherit;
  cursor: pointer;
  display: grid;
  gap: 1rem;
  grid-template-columns: minmax(0, 1fr) auto;
  min-height: 3.6rem;
  padding: 0.7rem 0.85rem;
  text-align: left;
}

.vibe64-manage__workspace:hover {
  border-color: rgba(var(--v-theme-primary), 0.55);
}

.vibe64-manage__workspace strong,
.vibe64-manage__workspace small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vibe64-manage__workspace strong {
  font-size: 0.98rem;
  font-weight: 720;
}

.vibe64-manage__workspace small {
  color: #64748b;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.78rem;
  margin-top: 0.25rem;
}

.vibe64-manage__empty {
  color: #64748b;
  margin: 2rem 0;
  text-align: center;
}

@media (max-width: 760px) {
  .vibe64-manage__bar,
  .vibe64-manage__create {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
