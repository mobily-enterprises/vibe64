<script setup>
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  mdiAccountCircleOutline,
  mdiLogoutVariant
} from "@mdi/js";
import {
  useVibe64AppAuth
} from "@/composables/useVibe64AppAuth.js";

const router = useRouter();
const route = useRoute();
const auth = useVibe64AppAuth();
const user = computed(() => auth?.state?.user || null);

async function openAccount() {
  await router.push({
    path: "/account",
    query: {
      returnTo: route.fullPath || route.path || "/app/manage/projects"
    }
  });
}

async function signOut() {
  await auth?.signOut?.();
  await router.replace("/");
}
</script>

<template>
  <v-menu v-if="user" location="bottom end">
    <template #activator="{ props }">
      <v-btn
        v-bind="props"
        class="vibe64-account-menu__button"
        icon
        size="small"
        variant="text"
        :title="user.email"
      >
        <v-avatar size="32">
          <v-img :src="user.gravatarUrl" :alt="user.email" />
        </v-avatar>
      </v-btn>
    </template>
    <v-list density="compact">
      <v-list-item
        :prepend-icon="mdiAccountCircleOutline"
        :subtitle="user.email"
        title="Account"
        @click="openAccount"
      />
      <v-list-item
        :prepend-icon="mdiLogoutVariant"
        title="Log out"
        @click="signOut"
      />
    </v-list>
  </v-menu>
</template>

<style scoped>
.vibe64-account-menu__button {
  margin-right: 0.75rem;
}
</style>
