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
import { ref, watch } from "vue";
import { RouterView, useRoute } from "vue-router";

const route = useRoute();
const pageTitle = ref("");

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
      </div>
    </template>
    <RouterView v-slot="{ Component }">
      <component :is="Component" @page-title-change="setPageTitle" />
    </RouterView>
  </ShellLayout>
</template>

<style scoped>
.studio-home-shell-heading {
  align-items: center;
  display: flex;
  min-width: 0;
}

.studio-home-shell-title {
  color: rgb(var(--v-theme-on-surface));
  font-size: 1.2rem;
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
  font-size: 0.95rem;
  font-weight: 650;
  line-height: 1.2;
  max-width: 12rem;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 600px) {
  .studio-home-shell-title {
    font-size: 1.05rem;
    max-width: calc(100vw - 8.5rem);
  }
}
</style>
