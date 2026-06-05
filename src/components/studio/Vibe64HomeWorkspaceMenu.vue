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
      class="vibe64-home-workspace-menu"
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
  mdiCogOutline,
  mdiHistory,
  mdiMenu,
  mdiMonitorDashboard,
  mdiPlayBoxMultipleOutline,
  mdiTune
} from "@mdi/js";

const route = useRoute();
const router = useRouter();
const menuOpen = ref(false);

const workspaceSlug = computed(() => firstRouteParam(route.params.slug));
const workspaceBasePath = computed(() => workspaceSlug.value ? `/app/${encodeURIComponent(workspaceSlug.value)}` : "/app/manage");
const isHomeRoute = computed(() => normalizePath(route.path) === normalizePath(workspaceBasePath.value));
const isAutopilotHome = computed(() => Boolean(
  isHomeRoute.value &&
  route.query.configure !== "project"
));
const menuItems = computed(() => {
  if (isAutopilotHome.value) {
    return sharedItems();
  }
  return [
    {
      description: "Return to the active session workspace.",
      icon: mdiMonitorDashboard,
      id: "workspace",
      label: "Workspace"
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
      description: "Edit Vibe64 project settings.",
      icon: mdiCogOutline,
      id: "configure",
      label: "Configure"
    },
    {
      description: "Run target project scripts.",
      icon: mdiPlayBoxMultipleOutline,
      id: "run",
      label: "Run"
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
  if (itemId === "workspace") {
    return workspaceBasePath.value;
  }
  if (itemId === "configure" || itemId === "run" || itemId === "history" || itemId === "setup") {
    return `${workspaceBasePath.value}/dashboard/${itemId}`;
  }
  return `${workspaceBasePath.value}/${itemId}`;
}

function itemRoute(item = {}) {
  return {
    path: pathForItem(item.id),
    query: {}
  };
}

function itemActive(item = {}) {
  if (item.id === "workspace") {
    return isHomeRoute.value && route.query.configure !== "project";
  }
  return route.path === pathForItem(item.id);
}

function selectItem(item = {}) {
  menuOpen.value = false;
  void router.push(itemRoute(item));
}

function firstRouteParam(value) {
  const rawValue = Array.isArray(value) ? value[0] : value;
  return String(rawValue || "").trim();
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
.vibe64-home-workspace-menu {
  max-width: min(24rem, calc(100vw - 2rem));
  min-width: min(18rem, calc(100vw - 2rem));
}
</style>
