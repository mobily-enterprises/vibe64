<route lang="json">
{
  "meta": {
    "jskit": {
      "scope": "global"
    }
  }
}
</route>

<script setup>
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  mdiArrowLeft
} from "@mdi/js";
import ShellLayout from "@/components/ShellLayout.vue";
import Vibe64AccountSettings from "@/components/auth/Vibe64AccountSettings.vue";
import { useStudioShellDrawer } from "@/composables/useStudioShellDrawer.js";

const route = useRoute();
const router = useRouter();

useStudioShellDrawer({
  hidden: true
});

const returnPath = computed(() => safeReturnPath(route.query.returnTo));

function firstQueryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function safeReturnPath(value) {
  const target = String(firstQueryValue(value) || "").trim();
  if (!target || !target.startsWith("/") || target.startsWith("//")) {
    return "/app/manage/projects";
  }
  if (target === "/account" || target.startsWith("/account?")) {
    return "/app/manage/projects";
  }
  if (
    target === "/app/manage" ||
    target.startsWith("/app/manage/") ||
    target.startsWith("/app/manage?")
  ) {
    return target;
  }
  const match = /^\/app\/([^/?#]+)(?:[/?#]|$)/u.exec(target);
  if (match && match[1] !== "manage") {
    return target;
  }
  return "/app/manage/projects";
}

async function goBack() {
  await router.push(returnPath.value);
}
</script>

<template>
  <ShellLayout>
    <template #top-left>
      <div class="vibe64-account-page__top">
        <v-btn
          :prepend-icon="mdiArrowLeft"
          type="button"
          variant="text"
          @click="goBack"
        >
          Back
        </v-btn>
        <h1 class="vibe64-account-page__title">Account</h1>
      </div>
    </template>
    <main class="vibe64-account-page">
      <Vibe64AccountSettings />
    </main>
  </ShellLayout>
</template>

<style scoped>
.vibe64-account-page {
  background: #f6f7f9;
  min-height: calc(100dvh - var(--v-layout-top, 0px));
}

.vibe64-account-page__top {
  align-items: center;
  display: flex;
  gap: 0.5rem;
  margin-left: 0.5rem;
}

.vibe64-account-page__title {
  font-size: 1.15rem;
  font-weight: 720;
  line-height: 1.2;
  margin: 0;
}
</style>
