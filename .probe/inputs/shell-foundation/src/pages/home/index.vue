<script setup>
import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";

const paths = usePaths();
const healthQuery = useQuery({
  queryKey: ["shell-web", "health"],
  queryFn: async () => {
    const response = await fetch("/api/health");
    if (!response.ok) {
      throw new Error("Health request failed.");
    }
    return response.json();
  },
  refetchOnWindowFocus: false
});

const health = computed(() => {
  if (healthQuery.error.value) {
    return "unreachable";
  }

  return healthQuery.data.value?.ok ? "ok" : "unhealthy";
});

const healthPending = computed(
  () => healthQuery.isPending.value || healthQuery.isFetching.value
);
</script>

<template>
  <section class="d-flex flex-column ga-4">
    <v-card>
      <v-list>
        <v-list-item subtitle="Service health">
          <template #title>
            <v-skeleton-loader
              v-if="healthPending"
              aria-label="Loading service health"
              type="text"
              max-width="80"
            />
            <span v-else>{{ health }}</span>
          </template>
        </v-list-item>
        <v-list-item title="/home" subtitle="Route" />
      </v-list>
    </v-card>
    <div class="d-flex justify-end">
      <v-btn color="secondary-container" prepend-icon="$settings" :to="paths.page('/settings')">Settings</v-btn>
    </div>
  </section>
</template>
