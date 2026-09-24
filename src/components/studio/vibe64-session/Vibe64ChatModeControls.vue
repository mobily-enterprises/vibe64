<script setup>
import { computed, ref, watch } from "vue";
import { mdiAutoFix, mdiCheck, mdiCodeBraces, mdiCompassOutline, mdiLeaf, mdiTuneVariant } from "@mdi/js";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { ModelRoutingForm, useModelRouting } from "@local/vibe64-accounts/client";
import { ASSISTANT_MODES, assistantRoutingFromMetadata } from "@local/vibe64-runtime/shared/assistantRouting";
import { vibe64SessionPath, VIBE64_SESSIONS_API_SUFFIX, VIBE64_SURFACE_ID } from "@/lib/vibe64SessionRequestConfig.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";
import { vibe64RealtimeOriginPayload } from "@/lib/vibe64BrowserTabOrigin.js";

const props = defineProps({ session: { type: Object, default: null }, sessionsApiPath: { type: [String, Object, Function], default: "" }, purposes: { type: Object, default: null }, savePreferences: { type: Function, default: null }, disabled: Boolean, active: Boolean, canConfigure: Boolean });
const emit = defineEmits(["saved"]);
const preferences = computed(() => assistantRoutingFromMetadata(props.session?.metadata));
const mode = ref("");
const review = ref(false);
const saving = ref(false);
const saveError = ref("");
const detailsOpen = ref(false);
const modeMenu = ref(null);
const routingOpen = ref(false);
const routingSaving = ref(false);
const modeIcons = { plan: mdiCompassOutline, code: mdiCodeBraces, economy: mdiLeaf, auto: mdiAutoFix };
const modeLabel = computed(() => ASSISTANT_MODES.find(({ id }) => id === mode.value)?.label || "");
const { engines, loadError, resource } = useModelRouting({ enabled: computed(() => Boolean(props.session?.sessionId)) });
const workflowEngineId = computed(() => preferences.value?.workflowEngineId || props.session?.assistantSelection?.engineId);
const engine = computed(() => engines.value.find(({ engineId }) => engineId === workflowEngineId.value));
const decisions = computed(() => props.purposes || engine.value?.preview?.viewer || {});
const goal = computed(() => props.session?.agentSession?.goal || props.session?.agentGoal?.goal ||
  JSON.parse(props.session?.metadata?.assistant_routing_goal || "null"));
const hasGoal = computed(() => Boolean(goal.value && !["completed", "complete"].includes(goal.value.status)) ||
  Boolean(props.session?.agentSession?.turn?.goalStatus && !["completed", "complete"].includes(props.session.agentSession.turn.goalStatus)));
const reviewAvailable = computed(() => !hasGoal.value && ["auto", "code"].includes(mode.value));
watch(preferences, (value) => { mode.value = value?.mode || ""; review.value = value?.review === true; }, { immediate: true });
function selectionLabel(selection) {
  return `${engines.value.find(({ engineId }) => engineId === selection.engineId)?.label || selection.engineId} · ${selection.modelId}`;
}
function roleLabel(role) {
  const decision = decisions.value[role === "router" ? "request_routing" : role];
  if (decision && !decision.available) return decision.message || "Unavailable";
  const selection = decision?.effectiveSelection || engine.value?.roles[role]?.assignment;
  if (!selection) return canConfigureMessage();
  return `${selectionLabel(selection)}${decision?.backupUsed ? ' · Shared backup' : ''}`;
}
function canConfigureMessage() {
  return props.canConfigure ? "Choose a model in Configure model routing." : "Ask the owner to configure this mode.";
}

const description = computed(() => {
  if (!mode.value) return `Current model · ${props.session?.assistantSelection?.modelId || "Choose an assistant"}`;
  if (mode.value === "auto") return decisions.value.auto?.available === false
    ? decisions.value.auto.message : `Router chooses Plan or Code · ${roleLabel("router")}`;
  const selectedOverride = preferences.value?.mode === mode.value && preferences.value.override;
  return selectedOverride && !decisions.value[mode.value] ? `${selectionLabel(selectedOverride)} · custom` : roleLabel(mode.value);
});
const triggerLabel = computed(() => `Chat mode${modeLabel.value ? `: ${modeLabel.value}` : ''}. ${description.value}${review.value && reviewAvailable.value ? '. Review after coding on' : ''}`);
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
    emit("saved");
  }
  catch (error) { mode.value = previous.mode; review.value = previous.review; saveError.value = error.message || "Chat mode could not be saved."; }
  finally { saving.value = false; }
}
function configure() {
  if (!props.canConfigure) return;
  detailsOpen.value = false;
  routingOpen.value = true;
}
</script>

<template>
  <v-menu ref="modeMenu" v-model="detailsOpen" :close-on-content-click="false" location="top start" :width="344" max-width="calc(100vw - 24px)">
    <template #activator="{ props: activatorProps }">
      <v-btn
        v-bind="activatorProps" class="chat-modes__trigger" variant="text" size="small"
        :icon="modeIcons[mode] || mdiTuneVariant" :aria-label="triggerLabel" :title="triggerLabel"
        :aria-busy="saving ? 'true' : undefined"
      />
    </template>
    <v-card class="chat-modes__details" rounded="lg">
      <div class="d-flex align-center justify-space-between px-4">
        <strong>Chat mode</strong>
        <v-btn variant="text" min-height="48" size="small" @click="detailsOpen = false">Close</v-btn>
      </div>
      <div class="chat-modes__details-body">
        <p v-if="active || saving || !mode" class="text-body-small px-4 pb-2" role="status">{{ saving ? 'Saving mode…' : active ? 'For your next request' : description }}</p>
        <v-alert v-if="saveError" type="error" variant="tonal" density="compact" class="mx-3 mb-2">{{ saveError }}</v-alert>
        <v-alert v-if="loadError" type="error" variant="tonal" density="compact" class="mx-3 mb-2">{{ loadError }} <v-btn variant="text" @click="resource.reload()">Retry</v-btn></v-alert>
        <v-skeleton-loader v-else-if="resource.isInitialLoading.value" type="list-item-two-line@4" />
        <template v-else>
          <v-list aria-label="Choose chat mode" class="py-0">
            <v-list-item
              v-for="choice in ASSISTANT_MODES" :key="choice.id"
              :title="choice.label" :prepend-icon="modeIcons[choice.id]"
              :active="mode === choice.id" :aria-pressed="mode === choice.id" role="button"
              :disabled="disabled || saving || hasGoal || decisions[choice.id]?.available === false" color="primary" min-height="60"
              @click="save(choice.id)"
            >
              <template #subtitle>
                <span class="chat-modes__model">{{ mode === choice.id ? description : choice.id === 'auto' ? decisions.auto?.message || choice.description : roleLabel(choice.id) }}</span>
              </template>
              <template #append>
                <v-icon v-if="mode === choice.id" :icon="mdiCheck" size="18" aria-label="Selected" />
              </template>
            </v-list-item>
          </v-list>
          <div class="px-4 pb-3">
            <p v-if="mode" class="text-body-small mt-2">{{ ASSISTANT_MODES.find(({ id }) => id === mode)?.description }}</p>
            <p v-if="engine && ['plan', 'code', 'economy', 'router'].some((role) => !engine.roles[role]?.assignment)" class="text-body-small mt-2">{{ canConfigure ? 'Assign missing models in Configure model routing below.' : 'Ask the owner to configure the missing models.' }}</p>
            <p v-if="decisions[mode]?.backupReason === 'keep_workflow_together'" class="text-body-small mt-2">Plan and Code use the shared backup together to keep this workflow in one orchestrator.</p>
            <v-switch :model-value="review" :disabled="disabled || saving || !reviewAvailable || !review && decisions.review?.available === false" label="Review after coding" hide-details color="primary" density="compact" @update:model-value="save(mode, $event)" />
            <p class="text-body-small">{{ hasGoal ? 'The mode is fixed during a goal. Auto and automatic review are unavailable.' : !reviewAvailable ? 'Available in Code and Auto.' : decisions.review?.available === false ? decisions.review.message : `${roleLabel('review')} checks the work and may fix issues. Uses an additional turn.` }}</p>
            <p v-if="mode === 'auto'" class="text-body-small mt-2">Router reads your request and recent chat first. Mixed or uncertain requests go to Plan.</p>
            <v-btn v-if="canConfigure" variant="text" min-height="48" size="small" class="mt-2" @click="configure">Configure model routing</v-btn>
          </div>
        </template>
      </div>
    </v-card>
  </v-menu>
  <v-dialog v-if="canConfigure" v-model="routingOpen" max-width="38rem" :persistent="routingSaving" scrollable aria-label="Model routing" @after-leave="modeMenu?.activatorEl?.focus()">
    <v-card>
      <v-card-text>
        <ModelRoutingForm v-if="routingOpen" :engine-id="workflowEngineId" @busy="routingSaving = $event" @close="routingOpen = false" @saved="routingSaving = false; routingOpen = false" />
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.chat-modes__trigger { flex-shrink: 0; }
.chat-modes__details { display: flex; flex-direction: column; max-height: min(560px, 75dvh); }
.chat-modes__details-body { overflow-y: auto; min-height: 0; }
.chat-modes__model { white-space: normal; overflow-wrap: anywhere; }
</style>
