<template>
  <v-menu
    v-model="menuOpen"
    location="bottom end"
    transition="scale-transition"
  >
    <template #activator="{ props: menuProps }">
      <v-btn
        v-bind="menuProps"
        :append-icon="mdiChevronDown"
        :prepend-icon="mdiMenu"
        size="small"
        type="button"
        variant="tonal"
      >
        Menu
      </v-btn>
    </template>

    <v-list
      class="vibe64-home-project-menu"
      density="comfortable"
      nav
    >
      <v-list-item
        v-for="item in menuItems"
        :key="item.id"
        :active="itemActive(item)"
        :prepend-icon="item.icon"
        :subtitle="item.description"
        :title="item.label"
        @click="selectItem(item)"
      />
    </v-list>
  </v-menu>
</template>

<script setup>
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  mdiChevronDown,
  mdiHistory,
  mdiMenu,
  mdiMonitorDashboard,
  mdiTune
} from "@mdi/js";
import {
  projectAppPath,
  projectRoutePathMatchesSection,
  projectSlugFromRoute
} from "@/lib/vibe64ProjectScope.js";

const route = useRoute();
const router = useRouter();
const menuOpen = ref(false);

const projectSlug = computed(() => projectSlugFromRoute(route));
const projectBasePath = computed(() => projectAppPath(projectSlug.value));
const isHomeRoute = computed(() => normalizePath(route.path) === normalizePath(projectBasePath.value));
const isAutopilotHome = computed(() => Boolean(isHomeRoute.value));
const menuItems = computed(() => {
  if (isAutopilotHome.value) {
    return sharedItems();
  }
  return [
    {
      description: "Return to the active session project.",
      icon: mdiMonitorDashboard,
      id: "project",
      label: "Project"
    },
    ...sharedItems()
  ];
});

function sharedItems() {
  return [
    {
      description: "Check local tools and project readiness.",
      icon: mdiTune,
      id: "setup",
      label: "Setup"
    },
    {
      description: "Review completed and abandoned sessions.",
      icon: mdiHistory,
      id: "history",
      label: "Session History"
    }
  ];
}

function pathForItem(itemId = "") {
  if (itemId === "project") {
    return projectBasePath.value;
  }
  if (itemId === "history" || itemId === "setup") {
    return `${projectBasePath.value}/dashboard/${itemId}`;
  }
  return `${projectBasePath.value}/${itemId}`;
}

function itemRoute(item = {}) {
  return {
    path: pathForItem(item.id),
    query: {}
  };
}

function itemActive(item = {}) {
  if (item.id === "project") {
    return isHomeRoute.value;
  }
  return projectRoutePathMatchesSection(route.path, pathForItem(item.id));
}

function selectItem(item = {}) {
  menuOpen.value = false;
  void router.push(itemRoute(item));
}

function normalizePath(pathValue = "") {
  const path = String(pathValue || "").trim();
  if (!path || path === "/") {
    return path || "/";
  }
  return path.replace(/\/+$/u, "");
}
</script>

<style scoped>
.vibe64-home-project-menu {
  max-width: min(24rem, calc(100vw - 2rem));
  min-width: min(18rem, calc(100vw - 2rem));
}
</style>
