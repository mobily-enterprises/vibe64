<template>
  <section class="generated-ui-screen generated-ui-screen--studio setup" aria-labelledby="setup-title">
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
</template>

<script setup>
import { computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import ProjectSelectionGate from "@/components/studio/ProjectSelectionGate.vue";
import ProjectTypeGate from "@/components/studio/ProjectTypeGate.vue";
import Vibe64SetupPanel from "@/components/studio/Vibe64SetupPanel.vue";

const tabs = [
  { label: "Studio Setup", value: "studio-setup" },
  { label: "Accounts", value: "accounts" },
  { label: "Adapter Setup", value: "adapter-setup" },
  { label: "Project Setup", value: "project-setup" }
];

const tabValues = new Set(tabs.map((tab) => tab.value));

const route = useRoute();
const router = useRouter();

function normalizeTab(value) {
  return typeof value === "string" && tabValues.has(value) ? value : "";
}

function fallbackTab() {
  return "studio-setup";
}

const activeTab = computed(() => normalizeTab(route.query.tab) || fallbackTab());

function tabRoute(tab) {
  return {
    path: "/home/setup",
    query: {
      ...route.query,
      tab
    }
  };
}

function selectTab(value, { replace = false } = {}) {
  const tab = normalizeTab(value) || "studio-setup";

  if (route.path === "/home/setup" && route.query.tab === tab) {
    return undefined;
  }

  return replace ? router.replace(tabRoute(tab)) : router.push(tabRoute(tab));
}

watch(
  () => route.query.tab,
  (tab) => {
    if (!normalizeTab(tab)) {
      void selectTab(fallbackTab(), { replace: true });
    }
  },
  { immediate: true }
);
</script>

<style scoped>
.setup {
  margin: 0 auto;
  min-width: 0;
  padding: clamp(1rem, 2vw, 1.5rem);
  width: min(100%, 68rem);
}

.setup__header {
  display: grid;
  gap: 0.25rem;
  margin-bottom: 1rem;
}

.setup__eyebrow {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  margin: 0;
  text-transform: uppercase;
}

.setup__title {
  font-size: clamp(1.75rem, 4vw, 2.5rem);
  font-weight: 800;
  letter-spacing: 0;
  line-height: 1;
  margin: 0;
}
</style>
