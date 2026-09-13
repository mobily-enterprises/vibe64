<script setup>
import { computed, ref, watch } from "vue";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { useVibe64ProjectSlug } from "@/composables/useVibe64ProjectScope.js";
import { VIBE64_SESSION_CHANGED_EVENT, vibe64SessionPath } from "@/lib/vibe64SessionRequestConfig.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";

const props = defineProps({
  active: Boolean,
  session: { type: Object, default: null },
  sessionsApiPath: { type: [Function, Object, String], default: "" }
});
const projectSlug = useVibe64ProjectSlug();
const sessionId = computed(() => props.session?.sessionId || "");
const sessionsPath = computed(() => String(readRefOrGetterValue(props.sessionsApiPath) || "").trim());
const enabled = computed(() => props.active && Boolean(sessionId.value && sessionsPath.value) &&
  props.session?.assistantSelection?.engineId === "codex");
const path = computed(() => vibe64SessionPath(sessionsPath.value, sessionId.value, "/agent-plan-usage"));
const usage = useEndpointResource({
  enabled,
  path,
  queryKey: computed(() => ["vibe64-codex-plan-usage", projectSlug.value, sessionsPath.value, sessionId.value]),
  fallbackLoadError: "Codex allowance is unavailable.",
  queryOptions: {
    queryFn: ({ signal }) => getHttpWebClient().request(path.value, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)])
    }),
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false
  }
});
useRealtimeEvent({
  enabled,
  event: VIBE64_SESSION_CHANGED_EVENT,
  matches: ({ payload = {} } = {}) => payload.projectSlug === projectSlug.value && payload.sessionId === sessionId.value && payload.reason === "codex-plan-usage",
  onEvent: () => { if (!globalThis.document?.hidden) void usage.reload(); }
});
const goalPath = computed(() => vibe64SessionPath(sessionsPath.value, sessionId.value, "/agent-goal"));
const goalResource = useEndpointResource({
  enabled,
  path: goalPath,
  queryKey: computed(() => ["vibe64-codex-goal", projectSlug.value, sessionsPath.value, sessionId.value]),
  fallbackLoadError: "Codex goal is unavailable.",
  queryOptions: {
    queryFn: ({ signal }) => getHttpWebClient().request(goalPath.value, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)])
    }),
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false
  }
});
useRealtimeEvent({
  enabled,
  event: VIBE64_SESSION_CHANGED_EVENT,
  matches: ({ payload = {} } = {}) => payload.projectSlug === projectSlug.value &&
    payload.sessionId === sessionId.value && payload.reason === "codex-goal",
  onEvent: () => { if (!globalThis.document?.hidden) void goalResource.reload(); }
});
const goal = computed(() => goalResource.data.value?.goal || null);
const goalStatusLabel = computed(() => ({
  active: "Goal active",
  paused: "Goal paused",
  blocked: "Goal blocked",
  usageLimited: "Goal waiting for allowance",
  budgetLimited: "Goal budget reached",
  complete: "Goal complete"
})[goal.value?.status] || "No goal");
const goalAvailable = computed(() => !goalResource.loadError.value && goalResource.data.value?.status === "available" && goal.value);
const goalRunning = computed(() => goalAvailable.value && goal.value.status === "active");
const goalUnavailableMessage = computed(() => goalResource.loadError.value || (
  goalResource.data.value?.status === "available"
    ? "No goal in this conversation."
    : "Goal status is unavailable."
));
const changingGoal = ref(false);
const goalError = ref("");
watch([sessionId, sessionsPath], () => {
  goalError.value = "";
});
async function changeGoal(action) {
  if (changingGoal.value || !goalAvailable.value) {
    return;
  }
  const targetSession = sessionId.value;
  changingGoal.value = true;
  goalError.value = "";
  try {
    const result = await getHttpWebClient().request(goalPath.value, {
      method: "POST",
      body: {
        action,
        threadId: goal.value.threadId,
        createdAt: goal.value.createdAt,
        objective: goal.value.objective
      }
    });
    if (result.ok === false) {
      throw new Error(result.error || "Could not change the Codex goal.");
    }
  } catch (error) {
    if (targetSession === sessionId.value) {
      goalError.value = error.message || "Could not change the Codex goal.";
    }
  } finally {
    changingGoal.value = false;
    if (targetSession === sessionId.value) {
      await goalResource.reload();
    }
  }
}
const weekly = computed(() => usage.data.value?.windows?.find((window) => window.windowDurationMins === 10080) || null);
const available = computed(() => !usage.loadError.value && usage.data.value?.status === "available" && weekly.value &&
  (!weekly.value.resetsAt || weekly.value.resetsAt * 1000 > Date.now()));
const summary = computed(() => available.value ? `${Math.floor(weekly.value.remainingPercent)}%` : "");
const details = computed(() => {
  if (!available.value) return "";
  const lines = [`Weekly Codex allowance remaining: ${summary.value}.`];
  if (weekly.value.resetsAt) lines.push(`Weekly resets ${new Date(weekly.value.resetsAt * 1000).toLocaleString()}.`);
  const shortTerm = usage.data.value.windows.find((window) => window.windowDurationMins === 300);
  if (shortTerm) {
    const expired = shortTerm.resetsAt && shortTerm.resetsAt * 1000 <= Date.now();
    lines.push(expired ? "5h allowance: awaiting update." : `5h allowance remaining: ${Math.floor(shortTerm.remainingPercent)}%.`);
    if (shortTerm.resetsAt) lines.push(`5h resets ${new Date(shortTerm.resetsAt * 1000).toLocaleString()}.`);
  }
  lines.push("Shared across sessions.");
  return lines.join("\n");
});
const indicatorTitle = computed(() => [
  details.value,
  goalAvailable.value ? goalStatusLabel.value : ""
].filter(Boolean).join("\n"));
const indicatorLabel = computed(() => [
  available.value ? `Weekly Codex allowance remaining: ${summary.value}` : "Codex goal",
  goalAvailable.value ? goalStatusLabel.value : ""
].filter(Boolean).join(". "));
</script>

<template>
  <v-menu v-if="enabled && (available || goalAvailable || goalError)" location="top" :close-on-content-click="false">
    <template #activator="{ props: menuProps }">
      <v-btn
        v-bind="menuProps"
        class="codex-plan-usage"
        size="small"
        variant="text"
        :title="indicatorTitle"
        :aria-label="indicatorLabel"
      >
        {{ summary || (!goalAvailable ? "!" : "") }}
        <span v-if="goalRunning" class="codex-plan-usage__running" aria-hidden="true" />
        <span v-else-if="goalAvailable && !summary" class="codex-plan-usage__goal" aria-hidden="true">{{ goal.status === 'paused' ? 'Ⅱ' : '○' }}</span>
      </v-btn>
    </template>
    <v-card max-width="340" class="pa-3">
      <template v-if="goalAvailable">
        <strong>{{ goalStatusLabel }}</strong>
        <p class="codex-plan-usage__details text-body-small">{{ goal.objective }}</p>
        <v-btn v-if="goalRunning" size="small" :loading="changingGoal" :disabled="changingGoal" @click="changeGoal('pause')">Pause goal</v-btn>
        <v-btn v-else-if="['paused', 'blocked', 'usageLimited'].includes(goal.status)" size="small" :loading="changingGoal" :disabled="changingGoal" @click="changeGoal('resume')">Resume goal</v-btn>
        <p v-if="goal.status === 'budgetLimited'" class="text-body-small">The goal reached its token budget. Adjust the budget in Codex before resuming.</p>
      </template>
      <p v-if="!goalAvailable" class="text-body-small">{{ goalUnavailableMessage }}</p>
      <p v-if="goalError" role="alert" class="text-error text-body-small">{{ goalError }}</p>
      <strong v-if="available">Codex plan allowance</strong>
      <p v-if="available" class="codex-plan-usage__details text-body-small">{{ details }}</p>
      <v-btn v-if="available" href="https://chatgpt.com/codex/settings/usage" target="_blank" rel="noopener noreferrer" size="small" variant="text">Usage details</v-btn>
      <v-btn size="small" variant="text" @click="usage.reload(); goalResource.reload()">Refresh</v-btn>
    </v-card>
  </v-menu>
</template>

<style scoped>
.codex-plan-usage { max-width: 100%; font-size: 0.7rem; text-transform: none; }
.codex-plan-usage__goal { margin-inline-start: 0.25rem; }
.codex-plan-usage__running {
  width: 6px;
  height: 6px;
  margin-inline-start: 6px;
  border-radius: 50%;
  background: rgb(var(--v-theme-success));
  box-shadow: 0 0 0 3px rgba(var(--v-theme-success), 0.12);
}
.codex-plan-usage__details { white-space: pre-line; margin-block: 0.5rem; }
</style>
