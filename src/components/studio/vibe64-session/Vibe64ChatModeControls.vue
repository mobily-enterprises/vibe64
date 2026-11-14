<script setup>
import { computed, ref, watch } from "vue";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { ModelRoutingForm } from "@local/vibe64-accounts/client";
import { ASSISTANT_FIX_MODE, ASSISTANT_MODES, assistantModeLabel, assistantRoutingAutomation, assistantRoutingFromMetadata } from "@local/vibe64-runtime/shared/assistantRouting";
import { ASSISTANT_FINISHING_DEFAULTS, AUTO_SAVE_SETTING } from "@local/vibe64-runtime/shared/assistantFinishing";
import { vibe64SessionPath, VIBE64_SESSIONS_API_SUFFIX, VIBE64_SURFACE_ID } from "@/lib/vibe64SessionRequestConfig.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";
import { vibe64RealtimeOriginPayload } from "@/lib/vibe64BrowserTabOrigin.js";
import { vibe64AssistantSelectionLabel } from "@local/vibe64-runtime/shared";
import { requestVibe64AccountConnectionsDialog } from "@/lib/vibe64AccountConnectionsDialog.js";

const props = defineProps({
  session: { type: Object, default: null },
  goal: { type: Object, default: null },
  sessionsApiPath: { type: [String, Object, Function], default: "" },
  purposes: { type: Object, default: null },
  // readable-check: allow collaborator-prop - optional operation: an AI task chat saves its routing through its conversation; main chat has none and saves through the session's command
  savePreferences: { type: /** @type {import("vue").PropType<((preferences: Record<string, any>) => Promise<Record<string, any>>) | null>} */ (Function), default: null },
  requiredMode: { type: String, default: "" },
  temporary: Boolean,
  disabled: Boolean,
  active: Boolean,
  connecting: Boolean,
  canConfigure: Boolean,
  loading: Boolean,
  loadError: { type: String, default: "" }
});
const emit = defineEmits(["saved", "reload", "custom"]);
const preferences = computed(() => assistantRoutingFromMetadata(props.session?.metadata));
const mode = ref("");
// Automatically save changes follows the shared default unless this chat changed it. The passes
// that run after a completed plan are ticked in Passes (After a plan); this control leaves them as saved.
const autoSave = ref(ASSISTANT_FINISHING_DEFAULTS.autoSave);
// What the switch's help line, mode label and off confirmation say.
const autoSaveText = {
  on: "Automatic save on", offTitle: "Turn off automatic save?", offAction: "Turn off automatic save",
  what: "Automatic save runs Save once a request's work is finished, and after the passes that run when a plan is completed.",
  lost: "Without it, finished work stays only in this session until you choose Save.",
  after: "Archiving a session never saves its work."
};
const offConfirmOpen = ref(false);
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
const modeIcons = { custom: "$tune", senior: "$workspacePremium", junior: "$person", auto: "$autoFix", fix: "$build" };
// Temporary chats add Fix it with AI; modes reserved for the owner are not listed.
const modes = computed(() => (props.temporary ? [...ASSISTANT_MODES.filter(({ id }) => id !== "auto"), ASSISTANT_FIX_MODE] : ASSISTANT_MODES)
  .filter(({ id }) => (!props.requiredMode || id === "custom" || id === props.requiredMode) && !decisions.value[id]?.approvalRequired));
const modeLabel = computed(() => assistantModeLabel(mode.value));
const decisions = computed(() => props.purposes || {});
const hasGoal = computed(() => Boolean(props.goal && !["completed", "complete"].includes(props.goal.status)));
// Main chat's mode, settings and model are the owner's; the server refuses a
// team member's change outside their own lesson.
const ownerOnly = computed(() => !props.temporary && decisions.value.senior?.approvalRequired === true);
// Main chat's Automatically save changes applies in every mode; temporary chats and
// lessons have none (a lesson teaches Save).
const finishingShown = computed(() => !props.temporary && props.session?.purpose !== "learning" &&
  Boolean(mode.value) && mode.value !== "fix");
const switchesAvailable = computed(() => finishingShown.value && !ownerOnly.value && !hasGoal.value);
// The server keeps the chat's after-plan passes; a temporary chat saves no finishing choice.
const updatedPreferences = computed(() => ({ mode: mode.value,
  ...(props.temporary ? {} : { autoSave: autoSave.value }),
  ...(modelOverride.value ? { override: modelOverride.value } : {}) }));
watch(preferences, (value) => {
  mode.value = value?.mode || ""; modelOverride.value = value?.override || null;
  autoSave.value = assistantRoutingAutomation(value).autoSave;
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
  ? decisions.value.auto.message : `Senior for plans, reviews and passes; Junior otherwise · Router: ${roleLabel("router")}`);
const description = computed(() => {
  if (!mode.value) return props.session?.assistantSelection ? `Current model · ${vibe64AssistantSelectionLabel(props.session.assistantSelection)}` : "Choose an assistant";
  if (mode.value === "auto") return autoDescription.value;
  const selectedOverride = preferences.value?.mode === mode.value && preferences.value.override;
  return selectedOverride && !decisions.value[mode.value] ? `${vibe64AssistantSelectionLabel(selectedOverride)} · custom` : roleLabel(mode.value);
});
// One sentence per part: a description may already end with a period.
const triggerLabel = computed(() => [`Chat mode${modeLabel.value ? `: ${modeLabel.value}` : ''}`, description.value,
  autoSave.value && switchesAvailable.value && autoSaveText.on
].filter(Boolean).map(part => part.replace(/\.$/u, '')).join('. '));
const switchesDescription = computed(() => {
  if (hasGoal.value) return "Auto and Chat settings apply after the current goal finishes.";
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
/**
 * Saves the chat's mode and any changed switch; a failed save puts both back.
 * @param {string} [nextMode]
 * @param {{ autoSave?: boolean }} [changes]
 */
async function save(nextMode = mode.value, changes = {}) {
  if (saving.value || props.disabled || !modes.value.some(({ id }) => id === nextMode) || nextMode === "auto" && props.temporary) return;
  const previous = { mode: mode.value, autoSave: autoSave.value, override: modelOverride.value };
  if (nextMode !== mode.value) modelOverride.value = null;
  mode.value = nextMode;
  autoSave.value = !props.temporary && (changes.autoSave ?? autoSave.value);
  saving.value = true;
  saveError.value = "";
  try {
    const result = props.savePreferences ? await props.savePreferences(updatedPreferences.value) : await command.run();
    if (result?.ok === false) throw new Error(result.error || "Chat mode could not be saved.");
    emit("saved");
  }
  catch (error) {
    mode.value = previous.mode;
    autoSave.value = previous.autoSave;
    modelOverride.value = previous.override;
    saveError.value = error.message || "Chat mode could not be saved.";
  }
  finally { saving.value = false; }
}
// While its off position is being confirmed the switch shows off; Cancel moves it
// back, so the switch always matches what is saved.
const shownAutoSave = computed(() => autoSave.value && !offConfirmOpen.value);
// Turning the switch off is confirmed first, naming what is lost; Cancel leaves it on.
function changeAutoSave(enabled) {
  if (enabled) return save(mode.value, { autoSave: true });
  offConfirmOpen.value = true;
}
function confirmAutoSaveOff() {
  offConfirmOpen.value = false;
  return save(mode.value, { autoSave: false });
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
        :icon="modeIcons[mode] || '$tune'" :aria-label="triggerLabel" :title="triggerLabel"
        :aria-busy="saving ? 'true' : undefined"
      />
    </template>
    <v-card class="chat-modes__details" rounded="lg">
      <div class="d-flex align-center justify-space-between px-4">
        <strong>Chat mode</strong>
        <div class="d-flex">
          <v-btn
            v-if="canConfigure"
            icon="$settings" variant="text"
            aria-label="Models" title="Models" @click="configure"
          />
          <v-btn icon="$close" variant="text" aria-label="Close chat mode" title="Close" @click="detailsOpen = false" />
        </div>
      </div>
      <div class="chat-modes__details-body">
        <p v-if="connecting || active || saving || !mode" class="text-body-small px-4 pb-2" role="status">{{ connecting ? 'Connecting assistant…' : saving ? 'Saving mode…' : active ? 'For your next request' : description }}</p>
        <v-alert v-if="saveError" type="error" variant="tonal" density="compact" class="mx-3 mb-2">{{ saveError }}</v-alert>
        <p v-if="ownerOnly" class="text-body-small px-4 pb-2" role="status">Main chat runs on the owner's AI. Only the owner can change its chat mode, Chat settings or model.</p>
        <p v-if="hasGoal" class="text-body-small px-4 pb-2" role="status">Model and Senior/Junior changes apply to the next goal turn. Another tool or Auto applies after this goal finishes.</p>
        <v-list :lines="false" class="py-0">
          <v-list-item
            :title="requiredMode ? 'Choose model' : 'Custom'" :prepend-icon="modeIcons.custom" :active="mode === 'custom'" role="button"
            :aria-pressed="mode === 'custom'" :disabled="disabled || saving || ownerOnly" color="primary" min-height="60"
            @click="openCustom"
          >
            <template #subtitle><span class="chat-modes__model">{{ mode === 'custom' ? description : roleLabel('custom') }}</span></template>
            <template #append><v-icon v-if="mode === 'custom'" icon="$check" size="18" aria-label="Selected" /></template>
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
                <v-icon v-if="mode === choice.id" icon="$check" size="18" aria-label="Selected" />
              </template>
            </v-list-item>
          </v-list>
          <div class="px-4 pb-3">
            <p v-if="requiredMode" class="text-body-small">Repair chats use Fix it with AI, or a model you choose. Model changes apply to the next turn.</p>
            <template v-if="finishingShown">
              <p class="text-body-small font-weight-bold">Chat settings</p>
              <v-switch
                :model-value="shownAutoSave" :disabled="disabled || saving || connecting || !switchesAvailable"
                :label="AUTO_SAVE_SETTING" hide-details color="primary" density="compact" @update:model-value="changeAutoSave($event)"
              />
              <p class="text-body-small">Saves once a request's work is finished. When a plan is completed, the passes ticked in Passes (After a plan) run first, each in its own turn; Review and Security pass always do.</p>
              <p v-if="switchesDescription" class="text-body-small">{{ switchesDescription }}</p>
            </template>
          </div>
        </template>
        <div class="px-4 pb-3"><slot :close="() => { detailsOpen = false; }" /></div>
      </div>
    </v-card>
    <!-- Inside the menu, so Vuetify counts it as the menu's child overlay: clicking in it leaves Chat mode open. -->
    <v-dialog v-model="offConfirmOpen" max-width="30rem" aria-labelledby="chat-modes-off-title">
      <v-card>
        <v-card-title id="chat-modes-off-title" class="text-wrap">{{ autoSaveText.offTitle }}</v-card-title>
        <v-card-text>
          <p class="mb-3">{{ autoSaveText.what }}</p>
          <p class="mb-3"><strong>{{ autoSaveText.lost }}</strong> {{ autoSaveText.after }}</p>
          <p>Cancel keeps it on.</p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="flat" color="primary" autofocus @click="offConfirmOpen = false">Cancel</v-btn>
          <v-btn variant="text" color="error" @click="confirmAutoSaveOff">{{ autoSaveText.offAction }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-menu>
  <v-dialog v-if="canConfigure" v-model="routingOpen" max-width="38rem" :persistent="routingSaving" scrollable aria-label="Models" @after-enter="routingFocusRole = decisions.auto?.missingRoles?.[0] || ''" @after-leave="modeMenu?.activatorEl?.focus()">
    <v-card>
      <v-card-text>
        <ModelRoutingForm
          v-if="routingOpen" :focus-role="routingFocusRole" @busy="routingSaving = $event" @close="routingOpen = false" @saved="routingSaving = false; routingOpen = false"
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
