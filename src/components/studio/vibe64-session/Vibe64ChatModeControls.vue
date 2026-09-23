<script setup>
import { computed, ref, watch } from "vue";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useModelRouting } from "@local/vibe64-accounts/client";
import { ASSISTANT_MODES, assistantRoutingFromMetadata } from "@local/vibe64-runtime/shared/assistantRouting";
import { vibe64SessionPath, VIBE64_SESSIONS_API_SUFFIX, VIBE64_SURFACE_ID } from "@/lib/vibe64SessionRequestConfig.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";
import { vibe64RealtimeOriginPayload } from "@/lib/vibe64BrowserTabOrigin.js";
import { requestVibe64AccountConnectionsDialog } from "@/lib/vibe64AccountConnectionsDialog.js";

const props = defineProps({ session: { type: Object, default: null }, sessionsApiPath: { type: [String, Object, Function], default: "" }, savePreferences: { type: Function, default: null }, disabled: Boolean, active: Boolean, canConfigure: Boolean });
const preferences = computed(() => assistantRoutingFromMetadata(props.session?.metadata));
const mode = ref("");
const review = ref(false);
const saving = ref(false);
const saveError = ref("");
const detailsOpen = ref(false);
const { engines, loadError, resource } = useModelRouting({ enabled: computed(() => Boolean(props.session?.sessionId)) });
const engine = computed(() => engines.value.find(({ engineId }) => engineId === props.session?.assistantSelection?.engineId));
const goal = computed(() => props.session?.agentSession?.goal || props.session?.agentGoal?.goal ||
  JSON.parse(props.session?.metadata?.assistant_routing_goal || "null"));
const hasGoal = computed(() => Boolean(goal.value && !["completed", "complete"].includes(goal.value.status)) ||
  Boolean(props.session?.agentSession?.turn?.goalStatus && !["completed", "complete"].includes(props.session.agentSession.turn.goalStatus)));
const reviewAvailable = computed(() => !hasGoal.value && ["auto", "code"].includes(mode.value));
watch(preferences, (value) => { mode.value = value?.mode || ""; review.value = value?.review === true; }, { immediate: true });
function roleLabel(role) {
  const assignment = engine.value?.roles[role]?.assignment;
  if (!assignment) return "Not configured";
  return `${engine.value.label} · ${assignment.modelId}`;
}
const description = computed(() => {
  if (!mode.value) return `Current model · ${props.session?.assistantSelection?.modelId || "Choose an assistant"}`;
  if (mode.value === "auto") return `Economy chooses Plan or Code · ${roleLabel("economy")}`;
  const selectedOverride = preferences.value?.mode === mode.value && preferences.value.override;
  return selectedOverride ? `${engine.value?.label || selectedOverride.engineId} · ${selectedOverride.modelId} · custom` : roleLabel(mode.value);
});
const command = useCommand({
  access: "never", apiSuffix: VIBE64_SESSIONS_API_SUFFIX, placementSource: "vibe64.sessions.assistant-selection.update",
  buildCommandOptions: () => ({ method: "PATCH", path: vibe64SessionPath(readRefOrGetterValue(props.sessionsApiPath), props.session.sessionId, "/assistant-selection") }),
  buildRawPayload: () => vibe64RealtimeOriginPayload({ assistantRouting: { mode: mode.value, review: review.value } }),
  onRunSuccess: (result) => { if (result?.ok === false) throw new Error(result.error || "Chat mode could not be saved."); },
  fallbackRunError: "Chat mode could not be saved.", suppressSuccessMessage: true,
  ownershipFilter: ROUTE_VISIBILITY_PUBLIC, surfaceId: VIBE64_SURFACE_ID, writeMethod: "PATCH"
});
async function save(nextMode = mode.value, nextReview = review.value) {
  if (saving.value || props.disabled || !nextMode || nextMode === "auto" && hasGoal.value) return;
  const previous = { mode: mode.value, review: review.value };
  mode.value = nextMode; review.value = nextReview; saving.value = true;
  saveError.value = "";
  try {
    const result = props.savePreferences ? await props.savePreferences({ mode: mode.value, review: review.value }) : await command.run();
    if (result?.ok === false) throw new Error(result.error || "Chat mode could not be saved.");
  }
  catch (error) { mode.value = previous.mode; review.value = previous.review; saveError.value = error.message || "Chat mode could not be saved."; }
  finally { saving.value = false; }
}
function configure() { detailsOpen.value = false; requestVibe64AccountConnectionsDialog({ section: "ai" }); }
</script>

<template>
  <section class="chat-modes" aria-label="Chat mode">
    <v-alert v-if="saveError" type="error" variant="tonal" density="compact">{{ saveError }}</v-alert>
    <div class="text-label-small mb-1">{{ active ? 'For your next request' : 'Chat mode' }}</div>
    <v-btn-toggle :model-value="mode" divided color="primary" variant="tonal" class="chat-modes__choices" :disabled="disabled || saving || hasGoal" @update:model-value="save($event)">
      <v-btn v-for="choice in ASSISTANT_MODES" :key="choice.id" class="chat-modes__choice" :value="choice.id" :disabled="choice.id === 'auto' && hasGoal" :title="choice.description" min-height="48">{{ choice.label }}</v-btn>
    </v-btn-toggle>
    <div class="d-flex align-center ga-1">
      <p class="text-body-small flex-grow-1 text-break" role="status">{{ saving ? 'Saving mode…' : description }}<span v-if="review && reviewAvailable && !saving"> · Review on</span></p>
      <v-menu v-model="detailsOpen" :close-on-content-click="false" location="top end" max-width="420">
        <template #activator="{ props: activatorProps }">
          <v-btn v-bind="activatorProps" variant="text" min-height="48" size="small" aria-label="Mode details and review settings">Details</v-btn>
        </template>
        <v-card class="chat-modes__details" rounded="lg">
          <div class="d-flex align-center justify-space-between px-4 pt-2">
            <strong>Chat modes</strong>
            <v-btn variant="text" min-height="48" @click="detailsOpen = false">Close</v-btn>
          </div>
          <v-card-text class="chat-modes__details-body">
            <v-alert v-if="loadError" type="error" variant="tonal" density="compact">{{ loadError }} <v-btn variant="text" @click="resource.reload()">Retry</v-btn></v-alert>
            <v-skeleton-loader v-else-if="resource.isInitialLoading.value" type="list-item-two-line" />
            <template v-else>
              <p v-for="role in ASSISTANT_MODES.filter(({ id }) => id !== 'auto')" :key="role.id" class="text-body-small mb-2"><strong>{{ role.label }}</strong> · {{ roleLabel(role.id) }}<br>{{ role.description }} <span v-if="engine?.roles[role.id]?.error">{{ engine.roles[role.id].error }}</span></p>
              <v-switch :model-value="review" :disabled="disabled || saving || !reviewAvailable" label="Review after coding" hide-details color="primary" @update:model-value="save(mode, $event)" />
              <p class="text-body-small">{{ hasGoal ? 'Goals require an explicit mode. Auto and automatic review are unavailable.' : !reviewAvailable ? 'Review runs after Code, including Code chosen by Auto.' : `Adds a visible review by ${roleLabel('plan')}. The reviewer may fix issues. This uses an additional turn and its account allowance.` }}</p>
              <p v-if="mode === 'auto'" class="text-body-small mt-2">Auto sends your request and recent visible chat to Economy first. Mixed or uncertain requests go to Plan.</p>
              <v-btn v-if="canConfigure" variant="text" min-height="48" class="mt-2" @click="configure">Configure model routing</v-btn>
            </template>
          </v-card-text>
        </v-card>
      </v-menu>
    </div>
  </section>
</template>

<style scoped>
.chat-modes { min-width: 0; }
.chat-modes__choices { width: 100%; height: auto; }
.chat-modes__choice { flex: 1 1 0; min-width: 48px; padding-inline: 8px; }
.chat-modes__details { display: flex; flex-direction: column; max-height: min(520px, 75dvh); }
.chat-modes__details-body { overflow-y: auto; }
</style>
