<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref, unref, watch } from "vue";
import { VIBE64_ACCOUNTS_CHANGED_EVENT } from "@local/vibe64-accounts/client";
import { AssistantGoalControl } from "@jskit-ai/assistant-core/client/conversation";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { useVibe64ProjectSlug } from "@/composables/useVibe64ProjectScope.js";
import { VIBE64_SESSION_CHANGED_EVENT, vibe64SessionPath } from "@/lib/vibe64SessionRequestConfig.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";
import { VIBE64_ASSISTANT_VIEWER_KEY } from "@/lib/vibe64AssistantHost.js";
import { VIBE64_CONNECTIONS_CHANGED_EVENT } from "@/lib/studioGateApi.js";
import { assistantRoutingFromMetadata } from "@local/vibe64-runtime/shared/assistantRouting";
import { findVibe64AgentProvider, vibe64ProviderPresentation } from "@local/vibe64-runtime/shared";

const props = defineProps({
  active: Boolean,
  session: { type: Object, default: null },
  conversationRuntime: { type: Object, default: null },
  sessionsApiPath: { type: [Function, Object, String], default: "" }
});
const projectSlug = useVibe64ProjectSlug();
const viewer = inject(VIBE64_ASSISTANT_VIEWER_KEY, { actorKey: "local" });
const actorKey = computed(() => unref(viewer)?.actorKey || "");
const sessionId = computed(() => props.session?.sessionId || "");
const sessionsPath = computed(() => String(readRefOrGetterValue(props.sessionsApiPath) || "").trim());
const engineId = computed(() => props.session?.assistantSelection?.engineId || "");
const modelProviderId = computed(() => props.session?.assistantSelection?.modelProviderId || "");
const keyUsage = computed(() => vibe64ProviderPresentation(props.session?.assistantSelection).keyUsage);
const goalEnabled = computed(() => props.active && Boolean(sessionId.value && sessionsPath.value && actorKey.value));
const enabled = computed(() => goalEnabled.value && (Boolean(findVibe64AgentProvider(engineId.value)?.planUsage) || keyUsage.value));
// Plan allowance is read once a minute, and only while the page is visible: a
// server read may start a one-shot Claude.
const PLAN_USAGE_POLL_MS = 60_000;
// A reading that states how long it stays current is shown only that long after it
// arrived; re-check while shown and when the tab returns, before any refetch lands.
const visible = ref(!globalThis.document?.hidden);
const now = ref(Date.now());
const tick = () => {
  visible.value = !globalThis.document?.hidden;
  now.value = Date.now();
};
let clock = null;
onMounted(() => {
  clock = setInterval(tick, 15_000);
  globalThis.document?.addEventListener("visibilitychange", tick);
});
onBeforeUnmount(() => {
  clearInterval(clock);
  globalThis.document?.removeEventListener("visibilitychange", tick);
});
const scopeKey = computed(() => JSON.stringify([projectSlug.value, sessionsPath.value, sessionId.value, actorKey.value]));
const connectionsRealtime = { events: [VIBE64_ACCOUNTS_CHANGED_EVENT, VIBE64_CONNECTIONS_CHANGED_EVENT], matches: () => true };
const path = computed(() => vibe64SessionPath(sessionsPath.value, sessionId.value, "/agent-plan-usage"));
const usage = useEndpointResource({
  enabled: computed(() => enabled.value && visible.value),
  path,
  queryKey: computed(() => ["vibe64-agent-plan-usage", engineId.value, modelProviderId.value, projectSlug.value, sessionsPath.value, sessionId.value, actorKey.value]),
  realtime: connectionsRealtime,
  fallbackLoadError: "Plan allowance is unavailable.",
  queryOptions: {
    meta: { jskit: { requestRecovery: false } },
    queryFn: ({ signal }) => getHttpWebClient().request(path.value, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)])
    }),
    retry: false,
    // Returning to the page, remounting or reconnecting reads again only once the
    // reading is a poll old, so switching tabs never adds reads. Key balances follow
    // turn events instead and always re-read their snapshot.
    staleTime: () => keyUsage.value ? 0 : PLAN_USAGE_POLL_MS,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchInterval: () => keyUsage.value ? false : PLAN_USAGE_POLL_MS,
    refetchIntervalInBackground: false
  }
});
useRealtimeEvent({
  enabled,
  event: VIBE64_SESSION_CHANGED_EVENT,
  matches: ({ payload = {} } = {}) => payload.projectSlug === projectSlug.value && payload.sessionId === sessionId.value &&
    ["agent-plan-usage", `${engineId.value}-plan-usage`].includes(payload.reason),
  onEvent: () => { if (!globalThis.document?.hidden) void usage.reload(); }
});
const suppliedGoal = computed(() => unref(props.conversationRuntime?.goalState));
const goalView = computed(() => unref(props.conversationRuntime?.goalView));
const goalAvailable = computed(() => goalEnabled.value && !suppliedGoal.value?.loading && suppliedGoal.value?.available !== false && !unref(props.conversationRuntime?.goalLoadError) &&
  goalView.value?.status === "available");
const goal = computed(() => goalAvailable.value ? goalView.value?.goal || null : null);
const goalEngineId = computed(() => goalView.value?.routing?.selection?.engineId || engineId.value);
const fullGoalOpen = ref(false);
const goalPreview = computed(() => {
  const objective = String(goal.value?.objective || "").trim();
  return objective.length > 140 ? `${objective.slice(0, 140).trimEnd()}…` : objective;
});
watch([sessionId, () => goal.value?.objective], () => { fullGoalOpen.value = false; });
const goalExplicitMode = computed(() => assistantRoutingFromMetadata(props.session?.metadata)?.mode !== "auto");
const changingGoal = computed(() => suppliedGoal.value?.pending === true);
const goalError = computed(() => suppliedGoal.value?.error || "");
async function changeGoal(action, input = {}) {
  // Pause and Cancel never wait on chat delivery; the binding says when they cannot run.
  const busy = ["pause", "cancel"].includes(action) ? suppliedGoal.value?.stopPending === true : changingGoal.value;
  if (busy || !goalAvailable.value) {
    return false;
  }
  if (["set", "resume"].includes(action) && !goalExplicitMode.value) return false;
  return props.conversationRuntime.changeGoal(action, input);
}
const currentUsage = computed(() => {
  const value = usage.data.value;
  if (keyUsage.value && (value?.engineId !== engineId.value || value?.modelProviderId !== modelProviderId.value)) return null;
  return value;
});
const weekly = computed(() => currentUsage.value?.windows?.find((window) => window.windowDurationMins === 10080 &&
  (keyUsage.value || engineId.value !== "claude" || window.id === "seven_day")) || null);
const allowance = computed(() => weekly.value || (keyUsage.value ? currentUsage.value?.windows?.[0] : null));
const balance = computed(() => currentUsage.value?.balances?.[0] || null);
const readingCurrent = computed(() => currentUsage.value?.status === "available" &&
  (!Number.isFinite(currentUsage.value.currentForMs) || now.value < usage.query.dataUpdatedAt.value + currentUsage.value.currentForMs));
const available = computed(() => {
  if (!enabled.value || usage.loadError.value || !readingCurrent.value) return false;
  return balance.value || (allowance.value && (!allowance.value.resetsAt || allowance.value.resetsAt * 1000 > Date.now()));
});
// Plan allowance says when it cannot be checked; key balances stay hidden until their next turn.
const cantCheck = computed(() => enabled.value && !keyUsage.value && !available.value &&
  Boolean(usage.loadError.value || ["available", "stale", "unavailable"].includes(currentUsage.value?.status)));
function formatBalance(value) {
  return new Intl.NumberFormat("en", {
    style: "currency", currency: value.currency, currencyDisplay: "narrowSymbol", minimumFractionDigits: 2, maximumFractionDigits: 2
  }).format(Number(value.amount));
}
const summary = computed(() => {
  if (cantCheck.value) return "?%";
  if (!available.value) return "";
  if (balance.value) return formatBalance(balance.value);
  return `${Math.floor(allowance.value.remainingPercent)}%`;
});
const planProvider = computed(() => keyUsage.value ? null : findVibe64AgentProvider(engineId.value)?.planUsage);
const usageLabel = computed(() => currentUsage.value?.providerLabel || planProvider.value?.label || "");
const usageTitle = computed(() => `${usageLabel.value} ${balance.value ? "balance" : "plan allowance"}`);
const summaryLabel = computed(() => cantCheck.value ? `Weekly ${usageLabel.value} allowance: can't check right now`
  : balance.value ? `${usageLabel.value} balance remaining: ${summary.value}`
    : `${weekly.value ? "Weekly " : ""}${usageLabel.value} allowance remaining: ${summary.value}`);
const managementUrl = computed(() => currentUsage.value?.managementUrl || planProvider.value?.managementUrl || "");
const details = computed(() => {
  if (cantCheck.value) {
    const lines = [`Can't check your ${usageLabel.value} allowance right now.`];
    if (weekly.value && currentUsage.value?.checkedAt) lines.push(`Last checked ${new Date(currentUsage.value.checkedAt).toLocaleString(undefined, {
      dateStyle: "medium", timeStyle: "short" })}: ${Math.floor(weekly.value.remainingPercent)}% weekly remaining.`);
    return lines.join("\n");
  }
  if (!available.value) return "";
  const snapshot = currentUsage.value;
  if (balance.value) return [
    ...snapshot.balances.map((value) => `${value.currency} balance remaining: ${formatBalance(value)}.`),
    `Checked ${new Date(snapshot.checkedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.`,
    "Account balance associated with this key. Shared across sessions. Updates at the start and end of a turn."
  ].join("\n");
  const lines = [`${summaryLabel.value}.`];
  if (weekly.value?.resetsAt) lines.push(`Weekly resets ${new Date(weekly.value.resetsAt * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.`);
  const shortTerm = snapshot.windows.find((window) => window.windowDurationMins === 300);
  if (shortTerm) {
    const expired = shortTerm.resetsAt && shortTerm.resetsAt * 1000 <= Date.now();
    lines.push(expired ? "5h allowance: awaiting update." : `5h allowance remaining: ${Math.floor(shortTerm.remainingPercent)}%.`);
    if (shortTerm.resetsAt) lines.push(`5h resets ${new Date(shortTerm.resetsAt * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.`);
  }
  for (const window of snapshot.windows.filter((window) => window.id?.startsWith("seven_day_") &&
    (!window.resetsAt || window.resetsAt * 1000 > Date.now()))) {
    lines.push(`${window.id.slice(10).replaceAll("_", " ")}: ${Math.floor(window.remainingPercent)}% weekly remaining.`);
  }
  lines.push("Shared across sessions.");
  if (keyUsage.value) lines.push(`Checked ${new Date(snapshot.checkedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.`,
    "Updates at the start and end of a turn.");
  return lines.join("\n");
});
const goalState = computed(() => ({
  ...suppliedGoal.value,
  enabled: goalEnabled.value && Boolean(suppliedGoal.value?.loading || goalAvailable.value || goalError.value),
  goal: goalAvailable.value && goal.value ? {
    ...goal.value,
    objective: goalPreview.value,
    elapsedSeconds: goal.value.timeUsedSeconds,
    sampledAt: Date.parse(goal.value.updatedAt)
  } : null,
  pending: changingGoal.value,
  error: goalError.value,
  set: goalExplicitMode.value ? (input) => changeGoal("set", input) : null,
  pauseBlocked: goalEngineId.value === "claude",
  pause: () => changeGoal("pause"),
  resume: goalExplicitMode.value ? () => changeGoal("resume") : null,
  cancel: () => changeGoal("cancel")
}));
</script>

<template>
  <AssistantGoalControl v-if="['codex', 'claude'].includes(goalEngineId)" :key="scopeKey" :state="goalState">
    <p v-if="!goalExplicitMode" class="text-body-small mt-2">Choose Senior or Junior before starting or resuming a goal.</p>
    <v-btn v-if="goal?.objective && goalPreview !== goal.objective" class="mt-2" size="small" variant="text" @click="fullGoalOpen = true">
      View full goal
    </v-btn>
  </AssistantGoalControl>
  <v-dialog v-if="fullGoalOpen" v-model="fullGoalOpen" max-width="640" scrollable aria-label="Full goal">
    <v-card>
      <v-card-title>Full goal</v-card-title>
      <v-card-text class="agent-plan-usage__goal-text">{{ goal?.objective }}</v-card-text>
      <v-card-actions>
        <v-btn @click="fullGoalOpen = false">Close</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
  <v-menu v-if="enabled && (available || cantCheck)" location="top" :close-on-content-click="false">
    <template #activator="{ props: menuProps }">
      <v-btn
        v-bind="menuProps" class="agent-plan-usage" size="small" variant="text"
        :title="details" :aria-label="summaryLabel"
      >
        {{ summary }}
      </v-btn>
    </template>
    <v-card max-width="340" class="pa-3">
      <strong>{{ usageTitle }}</strong>
      <p class="agent-plan-usage__details text-body-small">{{ details }}</p>
      <v-btn :href="managementUrl" target="_blank" rel="noopener noreferrer" size="small" variant="text">Usage details</v-btn>
      <v-btn v-if="!keyUsage" size="small" variant="text" @click="usage.reload()">Refresh</v-btn>
    </v-card>
  </v-menu>
</template>

<style scoped>
.agent-plan-usage { max-width: 100%; font-size: 0.7rem; text-transform: none; }
.agent-plan-usage__details { white-space: pre-line; margin-block: 0.5rem; }
.agent-plan-usage__goal-text { white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
