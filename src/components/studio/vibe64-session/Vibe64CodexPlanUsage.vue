<script setup>
import { computed, ref, watch } from "vue";
import { AssistantGoalControl } from "@jskit-ai/assistant-core/client/conversation";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { useVibe64ProjectSlug } from "@/composables/useVibe64ProjectScope.js";
import { VIBE64_SESSION_CHANGED_EVENT, vibe64SessionPath } from "@/lib/vibe64SessionRequestConfig.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";

const props = defineProps({
  active: Boolean,
  usageTarget: { type: Object, default: null },
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
const fullGoalOpen = ref(false);
const goalPreview = computed(() => {
  const objective = String(goal.value?.objective || "").trim();
  return objective.length > 140 ? `${objective.slice(0, 140).trimEnd()}…` : objective;
});
watch([sessionId, () => goal.value?.objective], () => { fullGoalOpen.value = false; });
const goalAvailable = computed(() => !goalResource.loadError.value && goalResource.data.value?.status === "available");
const changingGoal = ref(false);
const goalError = ref("");
watch([sessionId, sessionsPath], () => {
  goalError.value = "";
});
async function changeGoal(action, input = {}) {
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
        threadId: goal.value?.threadId || goalResource.data.value?.threadId || "",
        createdAt: goal.value?.createdAt,
        objective: goal.value?.objective,
        ...input
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
const goalState = computed(() => ({
  enabled: enabled.value && Boolean(goalAvailable.value || goalError.value),
  goal: goalAvailable.value && goal.value ? {
    ...goal.value,
    objective: goalPreview.value,
    elapsedSeconds: goal.value.timeUsedSeconds,
    sampledAt: Number.isFinite(goal.value.updatedAt)
      ? goal.value.updatedAt * (goal.value.updatedAt < 1_000_000_000_000 ? 1000 : 1) : undefined
  } : null,
  pending: changingGoal.value,
  error: goalError.value,
  set: (input) => changeGoal("set", input),
  pause: () => changeGoal("pause"),
  resume: () => changeGoal("resume")
}));
</script>

<template>
  <AssistantGoalControl :state="goalState">
    <v-btn v-if="goal?.objective && goalPreview !== goal.objective" class="mt-2" size="small" variant="text" @click="fullGoalOpen = true">
      View full goal
    </v-btn>
  </AssistantGoalControl>
  <v-dialog v-if="fullGoalOpen" v-model="fullGoalOpen" max-width="640" scrollable aria-label="Full goal">
    <v-card>
      <v-card-title>Full goal</v-card-title>
      <v-card-text class="codex-plan-usage__goal-text">{{ goal?.objective }}</v-card-text>
      <v-card-actions>
        <v-btn @click="fullGoalOpen = false">Close</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
  <Teleport v-if="enabled && available" :to="usageTarget" :disabled="!usageTarget">
    <span v-if="usageTarget">Codex allowance</span>
    <v-menu location="top" :close-on-content-click="false">
      <template #activator="{ props: menuProps }">
        <v-btn
          v-bind="menuProps" class="codex-plan-usage" size="small" variant="text"
          :title="details" :aria-label="`Weekly Codex allowance remaining: ${summary}`"
        >
          {{ summary }}
        </v-btn>
      </template>
      <v-card max-width="340" class="pa-3">
        <strong>Codex plan allowance</strong>
        <p class="codex-plan-usage__details text-body-small">{{ details }}</p>
        <v-btn href="https://chatgpt.com/codex/settings/usage" target="_blank" rel="noopener noreferrer" size="small" variant="text">Usage details</v-btn>
        <v-btn size="small" variant="text" @click="usage.reload()">Refresh</v-btn>
      </v-card>
    </v-menu>
  </Teleport>
</template>

<style scoped>
.codex-plan-usage { max-width: 100%; font-size: 0.7rem; text-transform: none; }
.codex-plan-usage__details { white-space: pre-line; margin-block: 0.5rem; }
.codex-plan-usage__goal-text { white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
