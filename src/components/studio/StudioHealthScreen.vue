<template>
  <section class="studio-health">
    <Vibe64DashboardPageHeader
      description="Read-only checks for the editor, credentials, Genesis, and tools."
      :icon="mdiHeartPulse"
      title="Studio Health"
    >
      <template #actions>
        <v-btn
          :disabled="isFetching"
          :loading="isFetching"
          :prepend-icon="mdiRefresh"
          rounded="pill"
          type="button"
          variant="tonal"
          @click="reload"
        >
          Refresh
        </v-btn>
      </template>
    </Vibe64DashboardPageHeader>

    <v-alert
      v-if="loadError"
      border="start"
      type="error"
      variant="tonal"
    >
      {{ loadError }}
    </v-alert>

    <v-skeleton-loader
      v-else-if="isInitialLoading"
      aria-label="Checking Studio health"
      type="list-item-three-line@5"
    />

    <template v-else>
      <v-alert
        :type="health.healthy ? 'success' : 'warning'"
        variant="tonal"
      >
        {{ summaryText }}
      </v-alert>

      <div class="studio-health__checks">
        <article
          v-for="check in checks"
          :key="check.id"
          class="studio-health__check"
        >
          <v-icon
            :color="check.status === 'pass' ? 'success' : 'warning'"
            :icon="check.status === 'pass' ? mdiCheckCircleOutline : mdiAlertCircleOutline"
            size="22"
          />
          <div class="studio-health__check-copy">
            <div class="studio-health__check-heading">
              <strong>{{ check.label }}</strong>
              <span>{{ check.group }}</span>
            </div>
            <p>{{ check.observed }}</p>
            <small>{{ check.explanation }}</small>
            <Vibe64CopyCommand v-if="check.command" class="mt-1" :command="check.command" />
          </div>
        </article>
      </div>
    </template>
  </section>
</template>

<script setup>
import { computed } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import {
  mdiAlertCircleOutline,
  mdiCheckCircleOutline,
  mdiHeartPulse,
  mdiRefresh
} from "@mdi/js";
import Vibe64CopyCommand from "@/components/common/Vibe64CopyCommand.vue";
import Vibe64DashboardPageHeader from "@/components/studio/Vibe64DashboardPageHeader.vue";
import {
  STUDIO_HEALTH_ENDPOINT,
  studioHealthQueryKey
} from "@/lib/studioGateApi.js";
import { VIBE64_SURFACE_ID } from "@/lib/vibe64RequestConfig.js";
import { vibe64ResourceResponseError } from "@/lib/vibe64ApiResponses.js";

const resource = useEndpointResource({
  fallbackLoadError: "Studio Health could not run.",
  path: computed(() => STUDIO_HEALTH_ENDPOINT),
  queryKey: computed(() => studioHealthQueryKey(VIBE64_SURFACE_ID, ROUTE_VISIBILITY_PUBLIC)),
  queryOptions: {
    refetchOnMount: false,
    refetchOnWindowFocus: false
  },
  requestRecoveryLabel: "Studio Health"
});
const {
  data,
  isFetching,
  isInitialLoading,
  loadError: endpointLoadError,
  reload
} = resource;

const health = computed(() => data.value || {});
const checks = computed(() => Array.isArray(health.value.checks) ? health.value.checks : []);
const loadError = computed(() => (
  vibe64ResourceResponseError(health.value, "Studio Health could not run.") ||
  endpointLoadError.value
));
const summaryText = computed(() => {
  const summary = health.value.summary || {};
  if (health.value.healthy === true) {
    return `All ${Number(summary.total || checks.value.length)} platform checks passed.`;
  }
  return `${Number(summary.failed || 0)} of ${Number(summary.total || checks.value.length)} platform checks need attention.`;
});
</script>

<style scoped>
.studio-health {
  align-content: start;
  display: grid;
  gap: var(--v64-space-4, 16px);
  margin-inline: auto;
  max-width: 64rem;
  width: 100%;
}

.studio-health__check,
.studio-health__check-heading {
  display: flex;
}

.studio-health__check-copy p,
.studio-health__check-copy small {
  margin: 0;
}

.studio-health__check-heading span {
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
  font-size: 0.75rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.studio-health__checks {
  display: grid;
  gap: 0.75rem;
}

/* M3 filled cards for each check. */
.studio-health__check {
  align-items: start;
  background: var(--v64-surface-container-low);
  border: 1px solid var(--v64-outline-variant, rgba(0, 0, 0, 0.12));
  border-radius: var(--v64-shape-lg, 16px);
  gap: var(--v64-space-3, 12px);
  padding: var(--v64-space-4, 16px);
}

.studio-health__check-copy {
  display: grid;
  gap: 0.3rem;
  min-width: 0;
  overflow-wrap: anywhere;
}

.studio-health__check-heading {
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.55rem;
}

.studio-health__check-copy p {
  white-space: pre-line;
}

.studio-health__check-copy small {
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}
</style>
