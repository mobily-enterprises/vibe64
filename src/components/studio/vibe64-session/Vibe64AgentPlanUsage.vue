<script setup>
import { computed, inject, ref, unref, watch } from "vue";
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
const keyUsage = computed(() => ["deepseek", "zai", "zai-coding-plan"].includes(modelProviderId.value));
const engineLabel = computed(() => engineId.value === "claude" ? "Claude" : "Codex");
const claudeObjective = ref("");
const claudeGoalOpen = ref(false);
const goalEnabled = computed(() => props.active && Boolean(sessionId.value && sessionsPath.value && actorKey.value));
const enabled = computed(() => goalEnabled.value && (["codex", "claude"].includes(engineId.value) || keyUsage.value));
const scopeKey = computed(() => JSON.stringify([projectSlug.value, sessionsPath.value, sessionId.value, actorKey.value]));
const connectionsRealtime = { events: [VIBE64_ACCOUNTS_CHANGED_EVENT, VIBE64_CONNECTIONS_CHANGED_EVENT], matches: () => true };
const path = computed(() => vibe64SessionPath(sessionsPath.value, sessionId.value, "/agent-plan-usage"));
const usage = useEndpointResource({
  enabled,
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
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: () => keyUsage.value ? false : 60_000,
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
const goal = computed(() => goalEnabled.value ? goalView.value?.goal || null : null);
const goalEngineId = computed(() => goalView.value?.routing?.selection?.engineId || engineId.value);
const fullGoalOpen = ref(false);
const goalPreview = computed(() => {
  const objective = String(goal.value?.objective || "").trim();
  return objective.length > 140 ? `${objective.slice(0, 140).trimEnd()}…` : objective;
});
watch([sessionId, () => goal.value?.objective], () => { fullGoalOpen.value = false; });
const goalAvailable = computed(() => goalEnabled.value && !unref(props.conversationRuntime?.goalLoadError) &&
  goalView.value?.status === "available");
const goalExplicitMode = computed(() => assistantRoutingFromMetadata(props.session?.metadata)?.mode !== "auto");
const changingGoal = computed(() => suppliedGoal.value?.pending === true);
const goalError = computed(() => suppliedGoal.value?.error || "");
watch(scopeKey, () => {
  claudeObjective.value = "";
  claudeGoalOpen.value = false;
}, { flush: "sync" });
async function changeGoal(action, input = {}) {
  if (changingGoal.value || !goalAvailable.value) {
    return;
  }
  if (["set", "resume"].includes(action) && !goalExplicitMode.value) return false;
  const targetScope = scopeKey.value;
  const result = await props.conversationRuntime.changeGoal(action, input);
  if (result !== false && targetScope === scopeKey.value && action === "set") claudeObjective.value = "";
  return result;
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
const available = computed(() => {
  if (!enabled.value || usage.loadError.value || currentUsage.value?.status !== "available") return false;
  return balance.value || (allowance.value && (!allowance.value.resetsAt || allowance.value.resetsAt * 1000 > Date.now()));
});
function formatBalance(value) {
  return new Intl.NumberFormat("en", {
    style: "currency", currency: value.currency, currencyDisplay: "narrowSymbol", minimumFractionDigits: 2, maximumFractionDigits: 2
  }).format(Number(value.amount));
}
const summary = computed(() => {
  if (!available.value) return "";
  if (balance.value) return formatBalance(balance.value);
  return `${Math.floor(allowance.value.remainingPercent)}%`;
});
const usageLabel = computed(() => currentUsage.value?.providerLabel || engineLabel.value);
const usageTitle = computed(() => `${usageLabel.value} ${balance.value ? "balance" : "plan allowance"}`);
const summaryLabel = computed(() => balance.value ? `${usageLabel.value} balance remaining: ${summary.value}`
  : `${weekly.value ? "Weekly " : ""}${usageLabel.value} allowance remaining: ${summary.value}`);
const managementUrl = computed(() => currentUsage.value?.managementUrl ||
  (engineId.value === "claude" ? "https://claude.ai/settings/usage" : "https://chatgpt.com/codex/settings/usage"));
const details = computed(() => {
  if (!available.value) return "";
  const snapshot = currentUsage.value;
  if (balance.value) return [
    ...snapshot.balances.map((value) => `${value.currency} balance remaining: ${formatBalance(value)}.`),
    `Checked ${new Date(snapshot.checkedAt).toLocaleString()}.`,
    "Account balance associated with this key. Shared across sessions. Updates at the start and end of a turn."
  ].join("\n");
  const lines = [`${summaryLabel.value}.`];
  if (weekly.value?.resetsAt) lines.push(`Weekly resets ${new Date(weekly.value.resetsAt * 1000).toLocaleString()}.`);
  const shortTerm = snapshot.windows.find((window) => window.windowDurationMins === 300);
  if (shortTerm) {
    const expired = shortTerm.resetsAt && shortTerm.resetsAt * 1000 <= Date.now();
    lines.push(expired ? "5h allowance: awaiting update." : `5h allowance remaining: ${Math.floor(shortTerm.remainingPercent)}%.`);
    if (shortTerm.resetsAt) lines.push(`5h resets ${new Date(shortTerm.resetsAt * 1000).toLocaleString()}.`);
  }
  for (const window of snapshot.windows.filter((window) => window.id?.startsWith("seven_day_") &&
    (!window.resetsAt || window.resetsAt * 1000 > Date.now()))) {
    lines.push(`${window.id.slice(10).replaceAll("_", " ")}: ${Math.floor(window.remainingPercent)}% weekly remaining.`);
  }
  lines.push("Shared across sessions.");
  if (keyUsage.value) lines.push(`Checked ${new Date(snapshot.checkedAt).toLocaleString()}.`,
    "Updates at the start and end of a turn.");
  return lines.join("\n");
});
const goalState = computed(() => ({
  ...suppliedGoal.value,
  enabled: goalEnabled.value && Boolean(goalAvailable.value || goalError.value),
  goal: goalAvailable.value && goal.value ? {
    ...goal.value,
    objective: goalPreview.value,
    elapsedSeconds: goal.value.timeUsedSeconds,
    sampledAt: Date.parse(goal.value.updatedAt)
  } : null,
  pending: changingGoal.value,
  error: goalError.value,
  set: goalExplicitMode.value ? (input) => changeGoal("set", input) : null,
  pause: () => changeGoal("pause"),
  resume: goalExplicitMode.value ? () => changeGoal("resume") : null,
  cancel: () => changeGoal("cancel")
}));
</script>

<template>
  <AssistantGoalControl v-if="goalEngineId === 'codex'" :state="goalState">
    <p v-if="!goalExplicitMode" class="text-body-small mt-2">Choose Senior or Junior before starting or resuming a goal.</p>
    <v-btn v-if="goal?.objective && goalPreview !== goal.objective" class="mt-2" size="small" variant="text" @click="fullGoalOpen = true">
      View full goal
    </v-btn>
  </AssistantGoalControl>
  <v-menu v-if="goalEngineId === 'claude' && goalState.enabled" v-model="claudeGoalOpen" location="top" :close-on-content-click="false">
    <template #activator="{ props: menuProps }">
      <v-btn v-bind="menuProps" size="small" variant="text" :aria-label="goal ? `Goal ${goal.status}` : 'Set goal'">
        {{ goal ? 'Goal' : 'Set goal' }}
        <span v-if="goal" class="ml-1 text-medium-emphasis">· {{ goal.status }}</span>
      </v-btn>
    </template>
    <v-card class="pa-3" max-width="360">
      <strong role="status">{{ goal ? `Goal ${goal.status}` : 'Set a Claude goal' }}</strong>
      <p v-if="goal" class="my-2 agent-plan-usage__goal-text">{{ goalPreview }}</p>
      <p v-if="goal?.reason" class="text-body-small my-2">{{ goal.reason }}</p>
      <v-btn v-if="goal?.status === 'active'" size="small" :disabled="changingGoal" @click="changeGoal('pause')">
        {{ changingGoal ? 'Pausing…' : 'Pause goal' }}
      </v-btn>
      <v-btn v-if="goal?.status === 'paused' && goalExplicitMode" size="small" :disabled="changingGoal" @click="changeGoal('resume')">
        {{ changingGoal ? 'Resuming…' : 'Resume goal' }}
      </v-btn>
      <v-btn v-if="goal && goal.status !== 'complete'" color="error" size="small" variant="text" :disabled="changingGoal" @click="changeGoal('cancel')">Cancel goal</v-btn>
      <p v-if="goal && goal.status !== 'complete'" class="text-body-small mt-2">Pause stops the current turn and keeps the goal for later. Cancel also clears the goal.</p>
      <p v-if="!goalExplicitMode" class="text-body-small mt-2">Choose Senior or Junior before starting or resuming a goal.</p>
      <form v-if="goalExplicitMode && (!goal || goal.status === 'complete')" class="d-flex flex-column ga-3 mt-3" @submit.prevent="changeGoal('set', { objective: claudeObjective.trim() })">
        <v-textarea v-model="claudeObjective" label="Goal objective" placeholder="Describe the result Claude should work toward" rows="3" auto-grow maxlength="4000" :disabled="changingGoal" hide-details />
        <v-btn type="submit" class="align-self-start" size="small" :disabled="changingGoal || !claudeObjective.trim()">{{ changingGoal ? 'Starting…' : 'Start goal' }}</v-btn>
      </form>
      <v-btn v-if="goal?.objective && goalPreview !== goal.objective" size="small" variant="text" @click="fullGoalOpen = true">View full goal</v-btn>
      <p v-if="goalError" role="alert" class="text-error text-body-small mt-2">{{ goalError }}</p>
    </v-card>
  </v-menu>
  <v-dialog v-if="fullGoalOpen" v-model="fullGoalOpen" max-width="640" scrollable aria-label="Full goal">
    <v-card>
      <v-card-title>Full goal</v-card-title>
      <v-card-text class="agent-plan-usage__goal-text">{{ goal?.objective }}</v-card-text>
      <v-card-actions>
        <v-btn @click="fullGoalOpen = false">Close</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
  <v-menu v-if="enabled && available" location="top" :close-on-content-click="false">
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
