<template>
  <section class="generated-ui-screen generated-ui-screen--app studio-screen d-flex flex-column ga-3">
    <header class="studio-screen__header d-flex flex-column flex-md-row ga-3 align-md-end justify-space-between">
      <div>
        <h1 class="studio-screen__title">Home</h1>
        <p class="text-body-2 text-medium-emphasis mb-0 studio-screen__lede">
          Current project:
          <span class="font-weight-medium text-high-emphasis">{{ appNameLabel }}</span>
        </p>
      </div>

      <div class="d-flex ga-2 align-center flex-wrap">
        <v-chip
          v-if="currentApp"
          :color="currentApp.isJskitApp ? 'success' : 'warning'"
          variant="tonal"
        >
          {{ currentApp.isJskitApp ? "JSKIT app" : "Incomplete scaffold" }}
        </v-chip>
        <v-btn
          variant="tonal"
          color="primary"
          :loading="gateLoading || currentAppLoading"
          size="large"
          :prepend-icon="mdiRefresh"
          class="studio-screen__refresh-button"
          @click="loadHome"
        >
          Refresh
        </v-btn>
      </div>
    </header>

    <v-alert
      v-if="currentAppError"
      type="error"
      variant="tonal"
      border="start"
      class="studio-screen__alert"
    >
      {{ currentAppError }}
    </v-alert>

    <v-progress-linear
      v-if="(gateLoading || currentAppLoading) && !currentApp"
      color="primary"
      height="6"
      indeterminate
      rounded
    />

    <IssueSessionPanel v-if="currentApp" :key="issueSessionPanelKey" />

    <div v-if="currentApp" class="studio-screen__summary-grid">
      <v-sheet rounded="lg" border class="studio-screen__panel">
        <p class="text-caption text-medium-emphasis mb-1">Root path</p>
        <p class="text-body-2 font-weight-medium mb-0 studio-screen__path">{{ currentApp.rootPath }}</p>
      </v-sheet>

      <v-sheet rounded="lg" border class="studio-screen__panel">
        <p class="text-caption text-medium-emphasis mb-1">Tenancy</p>
        <p class="text-body-2 font-weight-medium mb-0">{{ configValue(currentApp.config.tenancyMode) }}</p>
      </v-sheet>

      <v-sheet rounded="lg" border class="studio-screen__panel">
        <p class="text-caption text-medium-emphasis mb-1">Surface</p>
        <p class="text-body-2 font-weight-medium mb-0">{{ configValue(currentApp.config.surfaceDefaultId) }}</p>
      </v-sheet>

      <v-sheet rounded="lg" border class="studio-screen__panel">
        <p class="text-caption text-medium-emphasis mb-1">Git</p>
        <p class="text-body-2 font-weight-medium mb-0">{{ gitSummary }}</p>
      </v-sheet>
    </div>

    <div v-if="currentApp" class="studio-screen__content-grid">
      <v-sheet rounded="lg" border class="studio-screen__panel">
        <div class="d-flex align-center justify-space-between ga-3 mb-3">
          <h2 class="text-subtitle-1 mb-0">Project Markers</h2>
          <v-chip :color="currentApp.isJskitApp ? 'success' : 'warning'" size="small" variant="tonal">
            {{ markerCountLabel }}
          </v-chip>
        </div>
        <v-list density="compact" class="studio-screen__list">
          <v-list-item
            v-for="marker in currentApp.markers"
            :key="marker.id"
            :title="marker.label"
            :subtitle="marker.exists ? 'Present' : 'Missing'"
          >
            <template #prepend>
              <v-icon :icon="marker.exists ? '$success' : '$warning'" />
            </template>
          </v-list-item>
        </v-list>
      </v-sheet>

      <v-sheet rounded="lg" border class="studio-screen__panel">
        <h2 class="text-subtitle-1 mb-3">Runtime Needs</h2>
        <div class="studio-screen__chips">
          <v-chip
            v-for="need in runtimeNeedItems"
            :key="need.key"
            :color="need.enabled ? 'warning' : 'default'"
            variant="tonal"
          >
            {{ need.label }}: {{ need.enabled ? "present" : "absent" }}
          </v-chip>
        </div>
      </v-sheet>

      <v-sheet rounded="lg" border class="studio-screen__panel">
        <h2 class="text-subtitle-1 mb-3">Surfaces</h2>
        <v-list v-if="currentApp.config.surfaces.length" density="compact" class="studio-screen__list">
          <v-list-item
            v-for="surface in currentApp.config.surfaces"
            :key="surface.id"
            :title="surface.label || surface.id"
            :subtitle="surfaceSubtitle(surface)"
          />
        </v-list>
        <p v-else class="text-body-2 text-medium-emphasis mb-0">No surfaces found.</p>
      </v-sheet>

      <v-sheet rounded="lg" border class="studio-screen__panel">
        <h2 class="text-subtitle-1 mb-3">JSKIT Packages</h2>
        <v-list
          v-if="currentApp.jskitLock.installedPackages.length"
          density="compact"
          class="studio-screen__list"
        >
          <v-list-item
            v-for="installedPackage in currentApp.jskitLock.installedPackages"
            :key="installedPackage.packageId"
            :title="installedPackage.packageId"
            :subtitle="packageSubtitle(installedPackage)"
          />
        </v-list>
        <p v-else class="text-body-2 text-medium-emphasis mb-0">No JSKIT lock packages found.</p>
      </v-sheet>

      <v-sheet rounded="lg" border class="studio-screen__panel studio-screen__panel--wide">
        <h2 class="text-subtitle-1 mb-3">NPM Scripts</h2>
        <div v-if="currentApp.packageJson.scripts.length" class="studio-screen__script-grid">
          <div
            v-for="script in currentApp.packageJson.scripts"
            :key="script.name"
            class="studio-screen__script"
          >
            <span class="font-weight-medium">{{ script.name }}</span>
            <code>{{ script.command }}</code>
          </div>
        </div>
        <p v-else class="text-body-2 text-medium-emphasis mb-0">No scripts found.</p>
      </v-sheet>

      <v-sheet rounded="lg" border class="studio-screen__panel studio-screen__panel--wide">
        <h2 class="text-subtitle-1 mb-3">Git Status</h2>
        <div v-if="currentApp.git.isRepo">
          <p class="text-body-2 mb-3">
            Branch:
            <span class="font-weight-medium">{{ configValue(currentApp.git.branch) }}</span>
          </p>
          <v-list v-if="currentApp.git.changedFiles.length" density="compact" class="studio-screen__list">
            <v-list-item
              v-for="file in currentApp.git.changedFiles"
              :key="`${file.code}:${file.path}`"
              :title="file.path"
              :subtitle="file.code"
            />
          </v-list>
          <p v-else class="text-body-2 text-medium-emphasis mb-0">Working tree clean.</p>
        </div>
        <p v-else class="text-body-2 text-medium-emphasis mb-0">No git repository detected.</p>
      </v-sheet>
    </div>

    <v-sheet
      v-if="!gateLoading && !currentAppLoading && !currentApp && !currentAppError"
      rounded="lg"
      border
      class="studio-screen__panel"
    >
      <h2 class="text-subtitle-1 mb-2">Current app unavailable</h2>
      <p class="text-body-2 text-medium-emphasis mb-0">
        The inspection endpoint did not return project metadata.
      </p>
    </v-sheet>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import {
  mdiRefresh
} from "@mdi/js";
import {
  consumeStudioGate,
  readCurrentApp,
  resolveStudioGate
} from "@/lib/studioApi.js";
import IssueSessionPanel from "@/components/studio/IssueSessionPanel.vue";

const router = useRouter();
const gateLoading = ref(false);
const currentApp = ref(null);
const currentAppLoading = ref(false);
const currentAppError = ref("");
const issueSessionPanelKey = ref(0);

const appNameLabel = computed(() => {
  return currentApp.value?.packageJson?.name || "loading";
});

const gitSummary = computed(() => {
  const git = currentApp.value?.git;
  if (!git?.checked) {
    return "Not checked";
  }
  if (!git.isRepo) {
    return "No repository";
  }
  return git.dirty ? `${git.changedFiles.length} changed` : "Clean";
});

const markerCountLabel = computed(() => {
  const markers = currentApp.value?.markers || [];
  const presentCount = markers.filter((marker) => marker.exists).length;
  return `${presentCount}/${markers.length}`;
});

const runtimeNeedItems = computed(() => {
  const needs = currentApp.value?.runtimeNeeds || {};
  return [
    { key: "auth", label: "Auth", enabled: needs.auth === true },
    { key: "users", label: "Users", enabled: needs.users === true },
    { key: "workspaces", label: "Workspaces", enabled: needs.workspaces === true },
    { key: "database", label: "Database", enabled: needs.database === true }
  ];
});

function configValue(value) {
  return String(value || "").trim() || "none";
}

function surfaceSubtitle(surface) {
  const flags = [];
  flags.push(surface.enabled ? "enabled" : "disabled");
  if (surface.requiresAuth) {
    flags.push("auth");
  }
  if (surface.requiresWorkspace) {
    flags.push("workspace");
  }
  if (surface.pagesRoot) {
    flags.push(`root: ${surface.pagesRoot}`);
  }
  return flags.join(" / ");
}

function packageSubtitle(installedPackage) {
  const parts = [];
  if (installedPackage.version) {
    parts.push(installedPackage.version);
  }
  if (installedPackage.sourceType) {
    parts.push(installedPackage.sourceType);
  }
  if (installedPackage.packagePath) {
    parts.push(installedPackage.packagePath);
  }
  return parts.join(" / ");
}

async function loadCurrentApp() {
  currentAppLoading.value = true;
  currentAppError.value = "";
  try {
    currentApp.value = await readCurrentApp();
  } catch (loadError) {
    currentAppError.value = String(loadError?.message || loadError || "Current app inspection failed.");
  } finally {
    currentAppLoading.value = false;
  }
}

async function loadHome() {
  gateLoading.value = true;
  currentAppError.value = "";
  try {
    const gate = consumeStudioGate("/home") || await resolveStudioGate();
    if (gate.route !== "/home") {
      await router.replace(gate.route || "/bootup");
      return;
    }
    consumeStudioGate("/home");
    await loadCurrentApp();
    issueSessionPanelKey.value += 1;
  } catch (loadError) {
    currentAppError.value = String(loadError?.message || loadError || "Studio readiness check failed.");
  } finally {
    gateLoading.value = false;
  }
}

onMounted(() => {
  void loadHome();
});
</script>

<style scoped>
.generated-ui-screen {
  --generated-ui-screen-title-size: clamp(1.2rem, 1.7vw, 1.55rem);
  --generated-ui-screen-panel-padding: 0.5rem 0.625rem;
}

.studio-screen {
  margin-inline: auto;
  max-width: 68rem;
}

.studio-screen__title {
  font-size: var(--generated-ui-screen-title-size);
  font-weight: 700;
  letter-spacing: 0;
  line-height: 1.05;
  margin: 0 0 0.15rem;
}

.studio-screen__lede,
.studio-screen__path,
.studio-screen__script code,
.studio-screen__list :deep(.v-list-item-title),
.studio-screen__list :deep(.v-list-item-subtitle) {
  overflow-wrap: anywhere;
}

.studio-screen__panel {
  padding: var(--generated-ui-screen-panel-padding);
}

.studio-screen__refresh-button {
  min-height: 48px;
}

.studio-screen__summary-grid,
.studio-screen__content-grid,
.studio-screen__script-grid {
  display: grid;
  gap: 0.375rem;
}

.studio-screen__summary-grid {
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
}

.studio-screen__content-grid {
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 21rem), 1fr));
}

.studio-screen__panel--wide {
  grid-column: 1 / -1;
}

.studio-screen__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.studio-screen__list {
  background: transparent;
  padding-block: 0;
}

.studio-screen__script-grid {
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr));
}

.studio-screen__script {
  align-items: start;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
  display: grid;
  gap: 0.35rem;
  min-width: 0;
  padding: 0.75rem;
}

.studio-screen__script code {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.8125rem;
  line-height: 1.4;
  white-space: normal;
}

@media (max-width: 520px) {
  .studio-screen {
    max-width: 100%;
  }

}
</style>
