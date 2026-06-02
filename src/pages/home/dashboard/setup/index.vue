<template>
  <section class="vibe64-dashboard-page">
    <Vibe64SetupPanel
      :model-value="activeTab"
      @update:model-value="selectTab"
    />
  </section>
</template>

<script setup>
import { computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import Vibe64SetupPanel from "@/components/studio/Vibe64SetupPanel.vue";

const tabs = [
  { label: "Studio Setup", value: "studio-setup" },
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
    path: "/home/dashboard/setup",
    query: {
      ...route.query,
      tab
    }
  };
}

function selectTab(value, { replace = false } = {}) {
  const tab = normalizeTab(value) || fallbackTab();

  if (route.path === "/home/dashboard/setup" && route.query.tab === tab) {
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
.vibe64-dashboard-page {
  display: grid;
  gap: 0.75rem;
  min-width: 0;
}
</style>
