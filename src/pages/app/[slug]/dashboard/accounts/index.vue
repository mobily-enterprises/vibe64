<script setup>
import { computed, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

const route = useRoute();
const router = useRouter();
const workspaceSlug = computed(() => firstRouteParam(route.params.slug));
const returnTo = computed(() => workspaceSlug.value
  ? `/app/${encodeURIComponent(workspaceSlug.value)}/dashboard/configure`
  : "/app/manage");

function firstRouteParam(value) {
  const rawValue = Array.isArray(value) ? value[0] : value;
  return String(rawValue || "").trim();
}

function redirectToAccount() {
  void router.replace({
    path: "/account",
    query: {
      returnTo: returnTo.value
    }
  });
}

onMounted(redirectToAccount);
watch(returnTo, redirectToAccount);
</script>

<template>
  <section class="vibe64-dashboard-account-redirect">
    <v-progress-circular color="primary" indeterminate />
  </section>
</template>

<style scoped>
.vibe64-dashboard-account-redirect {
  align-items: center;
  display: flex;
  justify-content: center;
  min-height: 12rem;
}
</style>
