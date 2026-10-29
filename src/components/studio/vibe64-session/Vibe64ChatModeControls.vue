<script setup>
import { computed, ref, watch } from "vue";
import { mdiAccountOutline, mdiAccountStarOutline, mdiAutoFix, mdiCheck, mdiClose, mdiCogOutline, mdiTuneVariant, mdiWrenchOutline } from "@mdi/js";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { ModelRoutingForm } from "@local/vibe64-accounts/client";
import { ASSISTANT_FIX_MODE, ASSISTANT_MODES, assistantModeLabel, assistantRoutingAutomation, assistantRoutingFromMetadata } from "@local/vibe64-runtime/shared/assistantRouting";
import { vibe64SessionPath, VIBE64_SESSIONS_API_SUFFIX, VIBE64_SURFACE_ID } from "@/lib/vibe64SessionRequestConfig.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";
import { vibe64RealtimeOriginPayload } from "@/lib/vibe64BrowserTabOrigin.js";
import { vibe64AssistantSelectionLabel } from "@local/vibe64-runtime/shared";
import { requestVibe64AccountConnectionsDialog } from "@/lib/vibe64AccountConnectionsDialog.js";

const props = defineProps({ session: { type: Object, default: null }, goal: { type: Object, default: null }, sessionsApiPath: { type: [String, Object, Function], default: "" }, purposes: { type: Object, default: null }, savePreferences: { type: Function, default: null }, requiredMode: { type: String, default: "" }, temporary: Boolean, disabled: Boolean, active: Boolean, connecting: Boolean, canConfigure: Boolean, loading: Boolean, loadError: { type: String, default: "" } });
const emit = defineEmits(["saved", "reload", "custom"]);
const preferences = computed(() => assistantRoutingFromMetadata(props.session?.metadata));
const mode = ref("");
// Deslop and automatic save follow the shared defaults unless this chat turned them off.
const review = ref(true);
const autoSave = ref(true);
const deslopConfirmOpen = ref(false);
const modelOverride = ref(null);
const saving = ref(false);
const saveError = ref("");
const detailsOpen = ref(false);
const modeMenu = ref(null);
const routingOpen = ref(false);
// The Models dialog's team key and other-tool steps live in AI setup.
function openAccountConnections(request) {
  routingOpen.value = false;
  requestVibe64AccountConnectionsDialog(request);
}
const routingFocusRole = ref("");
const routingSaving = ref(false);
const modeIcons = { custom: mdiTuneVariant, senior: mdiAccountStarOutline, junior: mdiAccountOutline, auto: mdiAutoFix, fix: mdiWrenchOutline };
// Temporary chats add Fix it with AI; modes reserved for the owner are not listed.
const modes = computed(() => (props.temporary ? [...ASSISTANT_MODES.filter(({ id }) => id !== "auto"), ASSISTANT_FIX_MODE] : ASSISTANT_MODES)
  .filter(({ id }) => (!props.requiredMode || id === "custom" || id === props.requiredMode) && !decisions.value[id]?.approvalRequired));
const modeLabel = computed(() => assistantModeLabel(mode.value));
const decisions = computed(() => props.purposes || {});
const hasGoal = computed(() => Boolean(props.goal && !["completed", "complete"].includes(props.goal.status)));
// Main chat's mode, review and model are the owner's; the server refuses a
// team member's change outside their own lesson.
const ownerOnly = computed(() => !props.temporary && decisions.value.senior?.approvalRequired === true);
const reviewAvailable = computed(() => !props.temporary && !ownerOnly.value && !hasGoal.value && mode.value === "auto");
const updatedPreferences = computed(() => ({ mode: mode.value, review: review.value,
  ...(props.temporary ? {} : { autoSave: autoSave.value }),
  ...(modelOverride.value ? { override: modelOverride.value } : {}) }));
watch(preferences, (value) => {
  mode.value = value?.mode || ""; modelOverride.value = value?.override || null;
  ({ review: review.value, autoSave: autoSave.value } = assistantRoutingAutomation(value));
}, { immediate: true });
function roleLabel(role) {
  if (role === "custom" && preferences.value?.mode !== "custom") return "Choose a model and thinking level.";
  const decision = decisions.value[role === "router" ? "request_routing" : role];
  if (decision && !decision.available) return decision.message || "Unavailable";
  const selection = decision?.effectiveSelection;
  if (!selection) return canConfigureMessage();
  return vibe64AssistantSelectionLabel(selection);
}
function canConfigureMessage() {
  return props.canConfigure ? "Choose a model in Models." : "Ask the owner to configure this mode.";
}

const autoDescription = computed(() => decisions.value.auto?.available === false
  ? decisions.value.auto.message : `Senior for plans and reviews; Junior otherwise · Router: ${roleLabel("router")}`);
const description = computed(() => {
  if (!mode.value) return props.session?.assistantSelection ? `Current model · ${vibe64AssistantSelectionLabel(props.session.assistantSelection)}` : "Choose an assistant";
  if (mode.value === "auto") return autoDescription.value;
  const selectedOverride = preferences.value?.mode === mode.value && preferences.value.override;
  return selectedOverride && !decisions.value[mode.value] ? `${vibe64AssistantSelectionLabel(selectedOverride)} · custom` : roleLabel(mode.value);
});
// One sentence per part: a description may already end with a period.
const triggerLabel = computed(() => [`Chat mode${modeLabel.value ? `: ${modeLabel.value}` : ''}`, description.value,
  review.value && reviewAvailable.value && 'Automatic deslop by Senior on',
  autoSave.value && reviewAvailable.value && 'Automatic save after plans on'
].filter(Boolean).map(part => part.replace(/\.$/u, '')).join('. '));
const reviewDescription = computed(() => {
  if (hasGoal.value) return "Auto and automatic review apply after the current goal finishes.";
  if (ownerOnly.value) return "";
  if (!reviewAvailable.value) return "Automatic review is available in Auto only.";
  if (decisions.value.review?.available === false) return decisions.value.review.message;
  return "";
});
const command = useCommand({
  access: "never", apiSuffix: VIBE64_SESSIONS_API_SUFFIX, placementSource: "vibe64.sessions.assistant-selection.update",
  buildCommandOptions: () => ({ method: "PATCH", path: vibe64SessionPath(readRefOrGetterValue(props.sessionsApiPath), props.session.sessionId, "/assistant-selection") }),
  buildRawPayload: () => vibe64RealtimeOriginPayload({ assistantRouting: updatedPreferences.value }),
  onRunSuccess: (result) => { if (result?.ok === false) throw new Error(result.error || "Chat mode could not be saved."); },
  fallbackRunError: "Chat mode could not be saved.", suppressSuccessMessage: true,
  ownershipFilter: ROUTE_VISIBILITY_PUBLIC, surfaceId: VIBE64_SURFACE_ID, writeMethod: "PATCH"
});
function openCustom() {
  if (props.disabled || saving.value || ownerOnly.value) return;
  detailsOpen.value = false;
  emit("custom", modeMenu.value?.activatorEl);
}
async function save(nextMode = mode.value, nextReview = review.value, nextAutoSave = autoSave.value) {
  if (saving.value || props.disabled || !modes.value.some(({ id }) => id === nextMode) || nextMode === "auto" && props.temporary) return;
  const previous = { mode: mode.value, review: review.value, autoSave: autoSave.value, override: modelOverride.value };
  if (nextMode !== mode.value) modelOverride.value = null;
  mode.value = nextMode; review.value = !props.temporary && nextReview; autoSave.value = !props.temporary && nextAutoSave; saving.value = true;
  saveError.value = "";
  try {
    const result = props.savePreferences ? await props.savePreferences(updatedPreferences.value) : await command.run();
    if (result?.ok === false) throw new Error(result.error || "Chat mode could not be saved.");
    emit("saved");
  }
  catch (error) {
    mode.value = previous.mode; review.value = previous.review; autoSave.value = previous.autoSave;
    modelOverride.value = previous.override;
    saveError.value = error.message || "Chat mode could not be saved.";
  }
  finally { saving.value = false; }
}
// Turning Deslop off is confirmed first; Cancel leaves it on.
function changeDeslop(enabled) {
  if (enabled) save(mode.value, true);
  else deslopConfirmOpen.value = true;
}
function confirmDeslopOff() {
  deslopConfirmOpen.value = false;
  save(mode.value, false);
}
function configure() {
  if (!props.canConfigure) return;
  routingFocusRole.value = "";
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
        <div class="d-flex">
          <v-btn
            v-if="canConfigure"
            :icon="mdiCogOutline" variant="text" width="48" height="48"
            aria-label="Models" title="Models" @click="configure"
          />
          <v-btn :icon="mdiClose" variant="text" width="48" height="48" aria-label="Close chat mode" title="Close" @click="detailsOpen = false" />
        </div>
      </div>
      <div class="chat-modes__details-body">
        <p v-if="connecting || active || saving || !mode" class="text-body-small px-4 pb-2" role="status">{{ connecting ? 'Connecting assistant…' : saving ? 'Saving mode…' : active ? 'For your next request' : description }}</p>
        <v-alert v-if="saveError" type="error" variant="tonal" density="compact" class="mx-3 mb-2">{{ saveError }}</v-alert>
        <p v-if="ownerOnly" class="text-body-small px-4 pb-2" role="status">Main chat runs on the owner's AI. Only the owner can change its chat mode, review or model.</p>
        <p v-if="hasGoal" class="text-body-small px-4 pb-2" role="status">Model and Senior/Junior changes apply to the next goal turn. Another tool or Auto applies after this goal finishes.</p>
        <v-list :lines="false" class="py-0">
          <v-list-item
            :title="requiredMode ? 'Choose model' : 'Custom'" :prepend-icon="modeIcons.custom" :active="mode === 'custom'" role="button"
            :aria-pressed="mode === 'custom'" :disabled="disabled || saving || ownerOnly" color="primary" min-height="60"
            @click="openCustom"
          >
            <template #subtitle><span class="chat-modes__model">{{ mode === 'custom' ? description : roleLabel('custom') }}</span></template>
            <template #append><v-icon v-if="mode === 'custom'" :icon="mdiCheck" size="18" aria-label="Selected" /></template>
          </v-list-item>
        </v-list>
        <v-alert v-if="loadError" type="error" variant="tonal" density="compact" class="mx-3 mb-2">{{ loadError }} <v-btn variant="text" @click="emit('reload')">Retry</v-btn></v-alert>
        <v-skeleton-loader v-else-if="loading" :type="`list-item-two-line@${modes.length - 1}`" />
        <template v-else>
          <v-list aria-label="Choose chat mode" :lines="false" class="py-0">
            <v-list-item
              v-for="choice in modes.filter(({ id }) => id !== 'custom')" :key="choice.id"
              :title="choice.label" :prepend-icon="modeIcons[choice.id]"
              :active="mode === choice.id" :aria-pressed="mode === choice.id" role="button"
              :disabled="disabled || saving || decisions[choice.id]?.available !== true" color="primary" min-height="60"
              :aria-disabled="disabled || saving || decisions[choice.id]?.available !== true ? 'true' : undefined"
              @click="save(choice.id)"
            >
              <template #subtitle>
                <span class="chat-modes__model">{{ mode === choice.id ? description : choice.id === 'auto' ? autoDescription : roleLabel(choice.id) }}</span>
              </template>
              <template #append>
                <v-icon v-if="mode === choice.id" :icon="mdiCheck" size="18" aria-label="Selected" />
              </template>
            </v-list-item>
          </v-list>
          <div class="px-4 pb-3">
            <p v-if="requiredMode" class="text-body-small">Repair chats use Fix it with AI, or a model you choose. Model changes apply to the next turn.</p>
            <template v-if="!temporary && mode === 'auto'">
              <p class="text-body-small">Senior always reviews Junior's completed work and, with Deslop on, cleans it up. Keep Deslop on unless this is a quick throwaway project. Automatic save runs Save once Senior completes a plan.</p>
              <v-switch :model-value="review" :disabled="disabled || saving || connecting || !reviewAvailable" label="Deslop during Senior review" hide-details color="primary" density="compact" @update:model-value="changeDeslop($event)" />
              <v-switch :model-value="autoSave" :disabled="disabled || saving || connecting || !reviewAvailable" label="Automatic save after completing a plan" hide-details color="primary" density="compact" @update:model-value="save(mode, review, $event)" />
              <p v-if="reviewDescription" class="text-body-small">{{ reviewDescription }}</p>
            </template>
          </div>
        </template>
        <div class="px-4 pb-3"><slot /></div>
      </div>
    </v-card>
  </v-menu>
  <v-dialog v-model="deslopConfirmOpen" max-width="30rem" aria-labelledby="chat-modes-deslop-off-title">
    <v-card>
      <v-card-title id="chat-modes-deslop-off-title" class="text-wrap">Turn off Deslop?</v-card-title>
      <v-card-text>
        <p class="mb-3">Deslop is the clean-up Senior does while reviewing: it removes duplicated helpers, dead code and muddled structure that AI-written code collects.</p>
        <p class="mb-3"><strong>Without it, code quality will suffer.</strong> Over time the project gets harder to change and may crash and burn, unless you run Deslop yourself regularly by asking the AI to “Deslop” in the chat.</p>
        <p>Only skip Deslop for a quick throwaway project. Cancel keeps it on.</p>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="flat" color="primary" autofocus @click="deslopConfirmOpen = false">Cancel</v-btn>
        <v-btn variant="text" color="error" @click="confirmDeslopOff">Turn off Deslop</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
  <v-dialog v-if="canConfigure" v-model="routingOpen" max-width="38rem" :persistent="routingSaving" scrollable aria-label="Models" @after-enter="routingFocusRole = decisions.auto?.missingRoles?.[0] || ''" @after-leave="modeMenu?.activatorEl?.focus()">
    <v-card>
      <v-card-text>
        <ModelRoutingForm v-if="routingOpen" :focus-role="routingFocusRole" @busy="routingSaving = $event" @close="routingOpen = false" @saved="routingSaving = false; routingOpen = false"
          @add-team-key="openAccountConnections({ providerId: 'ai', section: 'team' })" @connect-provider="openAccountConnections({ providerId: $event })"
        />
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
