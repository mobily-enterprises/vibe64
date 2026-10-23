<template>
  <section class="studio-health">
    <Vibe64DashboardPageHeader
      description="What this computer has, and what Vibe64 needs from it."
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
      <div class="studio-health__summary" :class="health.healthy ? 'studio-health__summary--ok' : 'studio-health__summary--attention'">
        <v-icon :icon="health.healthy ? mdiCheckCircle : mdiAlertCircleOutline" size="28" />
        <div>
          <strong>{{ summaryText }}</strong>
          <p v-if="optionalText">{{ optionalText }}</p>
        </div>
      </div>

      <section v-for="section in sections" :key="section.need" class="studio-health__section">
        <h2 class="studio-health__section-title">
          {{ section.title }}
          <span>{{ section.caption }}</span>
        </h2>
        <div class="studio-health__list">
          <template v-for="check in section.checks" :key="check.id">
            <ToolInstallRow
              v-if="check.tool && check.status !== 'pass'"
              :checking="isFetching"
              flat
              :optional="check.need === 'optional'"
              :tool="check.tool"
              class="studio-health__check studio-health__check--tool"
              @check="reload"
            />
            <article v-else class="studio-health__check" :class="{ 'studio-health__check--open': check.status !== 'pass' }">
              <v-icon :color="iconColor(check)" :icon="check.status === 'pass' ? mdiCheckCircle : mdiAlertCircleOutline" size="20" />
              <div class="studio-health__check-copy">
                <div class="studio-health__check-heading">
                  <strong>{{ check.label }}</strong>
                  <span v-if="check.status === 'pass'"><template v-for="(part, index) in breakable(found(check))" :key="index">{{ part }}<wbr></template></span>
                </div>
                <p v-if="check.status !== 'pass'" class="studio-health__sentence">{{ check.observed }}</p>
                <small v-if="check.explanation">{{ check.explanation }}</small>
                <Vibe64CopyCommand v-if="check.command" class="mt-1" :command="check.command" />
                <v-btn
                  v-if="check.id === aiSetupCheckId"
                  class="studio-health__action"
                  color="primary"
                  rounded="pill"
                  variant="flat"
                  @click="requestVibe64AiOnboarding()"
                >
                  Set up your AI
                </v-btn>
              </div>
            </article>
          </template>
        </div>
      </section>
    </template>
  </section>
</template>

<script setup>
import { computed } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import {
  mdiAlertCircleOutline,
  mdiCheckCircle,
  mdiHeartPulse,
  mdiRefresh
} from "@mdi/js";
import { requestVibe64AiOnboarding } from "@local/vibe64-accounts/client";
import Vibe64CopyCommand from "@/components/common/Vibe64CopyCommand.vue";
import ToolInstallRow from "@/components/studio/ToolInstallRow.vue";
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
  if (health.value.healthy === true) return "Vibe64 has what it needs.";
  const failed = Number(summary.failed || 0);
  return failed === 1 ? "One thing Vibe64 needs is missing." : `${failed} things Vibe64 needs are missing.`;
});
const optionalText = computed(() => {
  const missing = Number(health.value.summary?.optionalMissing || 0);
  if (!missing) return "";
  return missing === 1 ? "1 optional extra isn't set up. Nothing depends on it." : `${missing} optional extras aren't set up. Nothing depends on them.`;
});
// Needed first; optional extras only when there are any.
const sections = computed(() => [
  { need: "needed", title: "Needed", caption: "Vibe64 can't work without these." },
  { need: "optional", title: "Optional", caption: "Nice to have. Install them when you want them." }
].map((section) => ({
  ...section,
  // Things to do come first; extras that are simply not installed fold at the end.
  checks: checks.value.filter((check) => (check.need || "needed") === section.need)
    .map((check, index) => ({ check, index, rank: section.need === "optional" ? optionalRank(check) : 0 }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ check }) => check)
})).filter((section) => section.checks.length));

function optionalRank(check) {
  if (check.status === "pass") return 1;
  return check.tool ? 2 : 0;
}

// AI setup explains installing and connecting: offered once, on the first AI row that needs it.
const aiSetupCheckId = computed(() => checks.value
  .find((check) => ["ai-tool", "ai-auth"].includes(check.id) && check.status !== "pass")?.id || "");

// A found tool reads "26.5.0 · ~/bin/node" under its own name, not "Node.js Node.js 26.5.0".
function found(check) {
  const text = String(check.observed || "");
  const lead = `${check.label} `;
  return check.tool && text.startsWith(lead) ? text.slice(lead.length) : text;
}

// Long paths wrap after a slash, never in the middle of a name.
function breakable(text = "") {
  return String(text).split(/(?<=\/)/u);
}

function iconColor(check) {
  if (check.status === "pass") return "success";
  return check.need === "optional" ? "grey" : "warning";
}
</script>

<style scoped>
.studio-health {
  align-content: start;
  display: grid;
  gap: var(--v64-space-5, 24px);
  margin-inline: auto;
  max-width: 56rem;
  width: 100%;
}

.studio-health__summary {
  align-items: center;
  border-radius: var(--v64-shape-lg, 16px);
  display: flex;
  gap: var(--v64-space-4, 16px);
  padding: var(--v64-space-4, 16px) var(--v64-space-5, 24px);
}

.studio-health__summary strong { font: var(--v64-type-title-md); }
.studio-health__summary p { color: var(--v64-on-surface-variant); font: var(--v64-type-body-md); margin: 2px 0 0; }
.studio-health__summary--ok { background: var(--v64-success-container); }
.studio-health__summary--ok > .v-icon { color: var(--v64-success); }
.studio-health__summary--attention { background: color-mix(in srgb, rgb(var(--v-theme-warning)) 12%, rgb(var(--v-theme-surface))); }
.studio-health__summary--attention > .v-icon { color: rgb(var(--v-theme-warning)); }

.studio-health__section { display: grid; gap: var(--v64-space-2, 8px); }

.studio-health__section-title {
  align-items: baseline;
  display: flex;
  flex-wrap: wrap;
  font: var(--v64-type-title-md);
  gap: 0 var(--v64-space-3, 12px);
  margin: 0;
}

.studio-health__section-title span {
  color: var(--v64-on-surface-variant);
  font: var(--v64-type-body-md);
}

.studio-health__list {
  background: var(--v64-surface-container-low);
  border: 1px solid var(--v64-outline-variant);
  border-radius: var(--v64-shape-lg, 16px);
  overflow: hidden;
}

.studio-health__check {
  align-items: start;
  display: grid;
  gap: var(--v64-space-3, 12px);
  grid-template-columns: 20px minmax(0, 1fr);
  padding: var(--v64-space-3, 12px) var(--v64-space-4, 16px);
}

.studio-health__check + .studio-health__check { border-top: 1px solid var(--v64-outline-variant); }
/* Icons sit on the 24px heading line, like the tool rows' icons. */
.studio-health__check > .v-icon { margin-top: 2px; }
.studio-health__check--tool { padding-inline: var(--v64-space-4, 16px); }

.studio-health__check-copy {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.studio-health__check-heading {
  align-items: baseline;
  display: flex;
  flex-wrap: wrap;
  gap: 0 var(--v64-space-2, 8px);
  min-height: 24px;
}

.studio-health__check-heading strong { font-size: 0.9375rem; font-weight: 600; }

.studio-health__check-heading span {
  color: var(--v64-on-surface-variant);
  font-size: 0.8125rem;
  min-width: 0;
  overflow-wrap: break-word;
  white-space: pre-line;
}

.studio-health__sentence {
  color: var(--v64-on-surface-variant);
  font: var(--v64-type-body-md);
  margin: 2px 0 0;
}

.studio-health__action { justify-self: start; margin-top: var(--v64-space-2, 8px); }

.studio-health__check-copy small {
  color: var(--v64-on-surface-variant);
  font-size: 0.8125rem;
}
</style>
