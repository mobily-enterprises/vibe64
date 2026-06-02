<route lang="json">
{
  "meta": {
    "jskit": {
      "surface": "home"
    }
  }
}
</route>

<template>
  <ShellLayout>
    <template #top-left>
      <div class="setup__shell-heading">
        <h1 class="setup__shell-title">Setup</h1>
      </div>
    </template>

    <section class="setup" aria-labelledby="setup-title">
      <header class="setup__header">
        <p class="setup__eyebrow">Studio readiness</p>
        <h1 id="setup-title" class="setup__title">Setup</h1>
      </header>

      <ProjectSelectionGate>
        <ProjectTypeGate>
          <template #default>
            <Vibe64SetupPanel
              :model-value="activeTab"
              @update:model-value="selectTab"
            />
          </template>
        </ProjectTypeGate>
      </ProjectSelectionGate>
    </section>
  </ShellLayout>
</template>

<script setup>
import { computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import ShellLayout from "@/components/ShellLayout.vue";
import ProjectTypeGate from "@/components/studio/ProjectTypeGate.vue";
import ProjectSelectionGate from "@/components/studio/ProjectSelectionGate.vue";
import Vibe64SetupPanel from "@/components/studio/Vibe64SetupPanel.vue";
import { useStudioShellDrawer } from "@/composables/useStudioShellDrawer.js";

const tabs = [
  { label: "Studio Setup", value: "studio-setup" },
  { label: "Adapter Setup", value: "adapter-setup" },
  { label: "Project Setup", value: "project-setup" }
];

const tabValues = new Set(tabs.map((tab) => tab.value));

const route = useRoute();
const router = useRouter();

useStudioShellDrawer({
  hidden: true
});

function normalizeTab(value) {
  return typeof value === "string" && tabValues.has(value) ? value : "";
}

function fallbackTab() {
  return "studio-setup";
}

const activeTab = computed(() => normalizeTab(route.query.tab) || fallbackTab());

function tabRoute(tab) {
  return {
    path: "/setup",
    query: {
      ...route.query,
      tab
    }
  };
}

function selectTab(value, { replace = false } = {}) {
  const tab = normalizeTab(value) || "studio-setup";

  if (route.path === "/setup" && route.query.tab === tab) {
    return undefined;
  }

  return replace ? router.replace(tabRoute(tab)) : router.push(tabRoute(tab));
}

watch(
  () => route.query.tab,
  (tab) => {
    if (tab === "accounts") {
      void router.replace("/home/accounts");
      return;
    }
    if (!normalizeTab(tab)) {
      void selectTab(fallbackTab(), { replace: true });
    }
  },
  { immediate: true }
);
</script>

<style scoped>
.setup {
  width: min(100%, 68rem);
  min-width: 0;
  margin: 0 auto;
  padding: clamp(1rem, 2vw, 1.5rem);
}

.setup__header {
  display: grid;
  gap: 0.25rem;
  margin-bottom: 1rem;
}

.setup__eyebrow {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.setup__title {
  margin: 0;
  font-size: clamp(1.75rem, 4vw, 2.5rem);
  font-weight: 800;
  letter-spacing: -0.04em;
  line-height: 1;
}

.setup__shell-actions {
  align-items: center;
  display: flex;
  gap: 0.35rem;
  justify-content: flex-end;
  min-width: 0;
}

.setup__shell-heading {
  align-items: center;
  display: flex;
  min-width: 0;
  padding-left: 1rem;
}

.setup__shell-title {
  color: rgb(var(--v-theme-on-surface));
  font-size: 1.2rem;
  font-weight: 760;
  line-height: 1.2;
  margin: 0;
  min-width: 0;
}

</style>
