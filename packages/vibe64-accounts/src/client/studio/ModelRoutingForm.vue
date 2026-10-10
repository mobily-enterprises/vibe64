<script setup>
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useDisplay } from "vuetify";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { defineVibe64AssistantSelection, vibe64AssistantSelectionLabel, VIBE64_AGENT_PROVIDERS } from "@local/vibe64-runtime/shared";
import { ASSISTANT_ROUTING_ASSIGNMENTS, ASSISTANT_ROUTING_ROLE_DEFINITIONS } from "@local/vibe64-runtime/shared/assistantRouting";
import { useModelRouting } from "../composables/useModelRouting.js";
import { ACCOUNTS_ENDPOINT } from "../lib/accountsGateApi.js";

const props = defineProps({ connectionId: { type: String, default: "" }, connectionLabel: { type: String, default: "" },
  setupError: { type: String, default: "" },
  engineId: { type: String, required: true }, focusRole: { type: String, default: "" }, readonly: Boolean });
const emit = defineEmits(["close", "saved", "busy"]);
const { smAndDown } = useDisplay();
const selectedEngine = computed(() => props.engineId);
const customizing = ref(false);
const proposalMode = computed(() => Boolean(props.connectionId) && !customizing.value);
const { resource, engines, scopeKey, loadError: resourceError } = useModelRouting({ engineId: selectedEngine });
const otherModelsRequested = ref(false);
const otherModels = useModelRouting({ engineId: selectedEngine, includeOtherModels: true,
  enabled: computed(() => otherModelsRequested.value && !proposalMode.value) });
const refreshError = ref("");
const loadError = computed(() => resourceError.value || refreshError.value);
const draft = ref({});
const baseRevision = ref(null);
const recommendationReview = ref(null);
watch(selectedEngine, () => { recommendationReview.value = null; }, { flush: "sync" });
const proposals = ref([]);
const saving = ref(false);
const fieldErrors = ref({});
const reviewedHelpers = ref([]);
const preview = ref(null);
const previewPending = ref(false);
const previewError = ref("");
const retryPreview = ref(0);
const refreshingConnection = ref(Boolean(props.connectionId));
let savedPayload = "";
let savedAssignments = {};
let hydratedDraft = "";
const draftSnapshot = () => JSON.stringify({ draft: draft.value, proposals: proposals.value,
  reviewedHelpers: reviewedHelpers.value, customizing: customizing.value });
const canEdit = computed(() => !props.readonly && resource.data.value?.canConfigure === true);
const modelEngines = computed(() => otherModelsRequested.value && otherModels.resource.data.value?.revision === baseRevision.value
  ? otherModels.engines.value : engines.value);
const engine = computed(() => modelEngines.value.find(({ engineId }) => engineId === selectedEngine.value));
const engineLabel = computed(() => VIBE64_AGENT_PROVIDERS.find(({ id }) => id === selectedEngine.value)?.label || selectedEngine.value);
const roleFields = ref({});
watch([engine, () => props.focusRole], async () => {
  if (!props.focusRole) return;
  await nextTick();
  const field = roleFields.value[props.focusRole]?.$el;
  field?.scrollIntoView({ block: "center" });
  field?.querySelector('input[role="combobox"]')?.focus({ preventScroll: true });
}, { immediate: true });
const stale = computed(() => baseRevision.value !== null && resource.data.value?.revision !== baseRevision.value);
const roles = [ASSISTANT_ROUTING_ROLE_DEFINITIONS.find(({ id }) => id === "router"),
  ...ASSISTANT_ROUTING_ROLE_DEFINITIONS.filter(({ id }) => id !== "router"),
  { id: "sharedBackup", label: "Shared backup" }
].map(role => ({ ...role, crossOrchestrator: !["senior", "junior"].includes(role.id) }));
function choiceId(selection) { return selection ? JSON.stringify([selection.engineId, selection.modelProviderId, selection.modelId]) : ""; }
function sameChoice(left, right) { return choiceId(left) === choiceId(right) && left?.variantId === right?.variantId && left?.agentId === right?.agentId; }
const recommendedChanges = computed(() => !engine.value ? [] : roles.flatMap(({ id, label }) => {
  const proposed = engine.value.roles[id].recommendation;
  const previous = draft.value[selectedEngine.value]?.[id];
  if (!proposed || sameChoice(previous, proposed)) return [];
  const choice = choiceFor(proposed, id);
  const changes = [selectionLabel(proposed)];
  if (previous?.modelId === proposed.modelId && previous?.modelProviderId !== proposed.modelProviderId) changes.push(choice?.providerLabel || proposed.modelProviderId);
  if (previous && previous.agentId !== proposed.agentId) changes.push(`${proposed.agentId} agent`);
  return [{ role: id, label, proposed, description: changes.join(" · ") }];
}));
const suggestedChanges = computed(() => !engine.value?.connected || !engine.value.roles.senior.recommendation || !engine.value.roles.junior.recommendation
  ? [] : ASSISTANT_ROUTING_ASSIGNMENTS.flatMap((role) => {
  const { assignment, recommendation } = engine.value.roles[role];
  if (!recommendation || recommendation.modelProviderId !== props.connectionId ||
      recommendation.engineId !== selectedEngine.value || sameChoice(assignment, recommendation)) return [];
  return [{ id: `${selectedEngine.value}:${role}`, engineId: selectedEngine.value,
    role, label: roles.find(({ id }) => id === role).label, previous: assignment, proposed: recommendation }];
}));
function payload() {
  const orchestrators = JSON.parse(JSON.stringify(draft.value));
  if (proposalMode.value) for (const proposal of suggestedChanges.value) {
    if (proposals.value.includes(proposal.id)) orchestrators[proposal.engineId][proposal.role] = proposal.proposed;
  }
  const inScope = Object.entries(orchestrators).filter(([engineId]) => engineId === selectedEngine.value);
  const changes = Object.fromEntries(inScope.map(([engineId, assignments]) => [engineId,
    Object.fromEntries(Object.entries(assignments).filter(([role, selection]) => !sameChoice(selection, savedAssignments[engineId]?.[role])))
  ]).filter(([, assignments]) => Object.keys(assignments).length));
  return { revision: baseRevision.value, engineId: selectedEngine.value,
    orchestrators: changes, reviewedHelperWorkflows: reviewedHelpers.value.filter((id) => id === selectedEngine.value) };
}
function hydrate(data) {
  if (!data?.ok) return;
  recommendationReview.value = null;
  baseRevision.value = data.revision;
  draft.value = Object.fromEntries(data.engines.map((item) => [item.engineId,
    Object.fromEntries(ASSISTANT_ROUTING_ASSIGNMENTS.map((role) => [role, item.roles[role].assignment || null]))]));
  reviewedHelpers.value = [];
  fieldErrors.value = {};
  savedAssignments = JSON.parse(JSON.stringify(draft.value));
  savedPayload = JSON.stringify({ revision: data.revision, engineId: selectedEngine.value, orchestrators: {}, reviewedHelperWorkflows: [] });
  proposals.value = suggestedChanges.value.filter(({ previous }) => !previous || previous.selectionSource === "recommended").map(({ id }) => id);
  preview.value = data;
  hydratedDraft = draftSnapshot();
}
watch(scopeKey, () => {
  otherModelsRequested.value = false;
  baseRevision.value = null;
  draft.value = {};
  savedAssignments = {};
  proposals.value = [];
  preview.value = null;
  reviewedHelpers.value = [];
  fieldErrors.value = {};
  customizing.value = false;
  recommendationReview.value = null;
}, { flush: "sync" });
watch(() => resource.data.value, (data) => {
  if (!refreshingConnection.value && !saving.value && (baseRevision.value === null || draftSnapshot() === hydratedDraft)) hydrate(data);
}, { immediate: true });
onMounted(async () => {
  if (!refreshingConnection.value) return;
  await reload();
  refreshingConnection.value = false;
});
watch(saving, (value) => emit("busy", value));
const previewPayload = computed(() => JSON.stringify(payload()));
watch([previewPayload, retryPreview, canEdit, stale], ([serialized], _previous, cleanup) => {
  previewPending.value = false;
  if (baseRevision.value === null || !canEdit.value || stale.value) return;
  previewError.value = "";
  if (serialized === savedPayload) { preview.value = resource.data.value; return; }
  const controller = new AbortController();
  let current = true;
  previewPending.value = true;
  const timer = setTimeout(async () => {
    try {
      const result = await getHttpWebClient().request(`${ACCOUNTS_ENDPOINT}/model-routing/preview`, {
        method: "POST", body: JSON.parse(serialized), signal: controller.signal
      });
      if (result?.ok !== true) throw new Error(result?.error || "Routing preview could not be loaded.");
      if (current) preview.value = result;
    } catch (error) { if (current) previewError.value = error.message; }
    finally { if (current) previewPending.value = false; }
  }, 250);
  cleanup(() => { current = false; clearTimeout(timer); controller.abort(); });
}, { immediate: true });
const previewEngine = computed(() => preview.value?.engines?.find(({ engineId }) => engineId === selectedEngine.value));
const decisions = computed(() => previewEngine.value?.preview?.[canEdit.value ? "collaborator" : "viewer"] || {});
function choiceFor(selection, role = "senior") {
  return modelEngines.value.flatMap((item) => item.roles[role]?.choices || []).find((item) => choiceId(item) === choiceId(selection));
}
function selectionLabel(selection) {
  if (!selection) return "No model selected";
  return vibe64AssistantSelectionLabel(selection);
}
function items(role) {
  const current = draft.value[selectedEngine.value]?.[role];
  const choices = (engine.value?.roles[role]?.choices || []).map((choice) => {
    const agent = VIBE64_AGENT_PROVIDERS.find(({ id }) => id === choice.engineId)?.label || choice.engineId;
    const status = choice.compatibilityError ? "Compatibility pending" : !choice.available ? "Unavailable"
      : ["junior", "sharedBackup"].includes(role) && choice.capabilities?.toolcall === false ? "Tools unavailable" : "";
    return { id: choiceId(choice), engineId: choice.engineId, agent, label: choice.label || choice.modelId, status,
      recommended: !status && choiceId(choice) === choiceId(engine.value.roles[role].recommendation),
      props: { subtitle: `${choice.providerLabel} · ${choice.accessLabel}`, disabled: Boolean(status) } };
  });
  if (current && !choices.some(({ id }) => id === choiceId(current))) {
    const agent = VIBE64_AGENT_PROVIDERS.find(({ id }) => id === current.engineId)?.label || current.engineId;
    choices.unshift({ id: choiceId(current), engineId: current.engineId, agent, label: current.modelId,
      status: "Unavailable saved choice", props: { disabled: true } });
  }
  const groups = [...new Set([selectedEngine.value, ...choices.map(choice => choice.engineId)])].flatMap(engineId => {
    const models = choices.filter(choice => choice.engineId === engineId);
    return models.length ? [{ type: "subheader", id: `group:${engineId}`, label: models[0].agent }, ...models] : [];
  });
  return [{ id: "", label: role === "sharedBackup" ? "No shared backup" : "Choose a model" }, ...groups];
}
function choose(role, id) {
  const choice = engine.value.roles[role].choices.find((item) => choiceId(item) === id);
  draft.value[selectedEngine.value][role] = choice ? { ...defineVibe64AssistantSelection(choice), selectionSource: "explicit" } : null;
  delete fieldErrors.value[`${selectedEngine.value}.${role}`];
  if (role === "helper") reviewedHelpers.value = [];
}
function changeEffort(role, variantId) {
  draft.value[selectedEngine.value][role] = { ...draft.value[selectedEngine.value][role], variantId, selectionSource: "explicit" };
  delete fieldErrors.value[`${selectedEngine.value}.${role}`];
  if (role === "helper") reviewedHelpers.value = [];
}
function variants(role) { return choiceFor(draft.value[selectedEngine.value]?.[role], role)?.variants || []; }
function roleHint(role) {
  if (role.id === "sharedBackup") return "";
  if (stale.value) return "Reload current choices to check access.";
  if (previewPending.value) return "Checking access…";
  if (previewError.value) return "Access could not be checked.";
  const decision = decisions.value[role.id === "router" ? "request_routing" : role.id === "helper" ? "prompt_hint" : role.id];
  const result = decision?.available
    ? `${selectionLabel(decision.effectiveSelection)}${decision.backupUsed ? " (shared backup)" : ""}`
    : decision?.message || "Unavailable";
  return `${canEdit.value ? "Collaborators" : "You will get"}: ${result}`;
}
function roleError(role) {
  if (fieldErrors.value[`${selectedEngine.value}.${role}`]) return fieldErrors.value[`${selectedEngine.value}.${role}`];
  const state = previewEngine.value?.roles[role];
  return !previewPending.value && sameChoice(state?.assignment, draft.value[selectedEngine.value]?.[role]) ? state?.error || "" : "";
}
function reviewRecommendations() {
  if (!canEdit.value || saving.value || stale.value || !recommendedChanges.value.length) return;
  recommendationReview.value = { engineId: selectedEngine.value, changes: recommendedChanges.value };
}
function useRecommendations() {
  if (!recommendationReview.value || !canEdit.value || saving.value || stale.value) return;
  for (const { role, proposed } of recommendationReview.value.changes) {
    draft.value[recommendationReview.value.engineId][role] = proposed;
    delete fieldErrors.value[`${recommendationReview.value.engineId}.${role}`];
  }
  recommendationReview.value = null;
}
function customize() {
  const assignments = payload().orchestrators[selectedEngine.value];
  if (assignments) Object.assign(draft.value[selectedEngine.value], assignments);
  customizing.value = true;
}
const command = useCommand({
  access: "never", apiSuffix: "/vibe64/accounts/model-routing",
  buildCommandOptions: () => ({ method: "PATCH", path: `${ACCOUNTS_ENDPOINT}/model-routing` }), buildRawPayload: payload,
  onRunSuccess(response) {
    fieldErrors.value = response?.fieldErrors || {};
    if (response?.ok !== true) throw new Error(response?.error || "Model routing was not saved.");
  },
  messages: { success: "Model routing saved. New requests will use these assignments.", error: "Model routing was not saved." },
  fallbackRunError: "Model routing was not saved.", ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
  placementSource: "vibe64.accounts.model-routing", surfaceId: "app", writeMethod: "PATCH"
});
async function save() {
  if (saving.value || stale.value || !canEdit.value || previewPending.value || !engine.value?.connected) return;
  saving.value = true;
  try { const result = await command.run(); if (result?.ok === true) { await resource.reload(); emit("saved"); } }
  catch { /* Shared command feedback reports errors; keep this draft and its field errors. */ }
  finally { saving.value = false; }
}
async function reload() {
  refreshError.value = "";
  try { await resource.reload(); if (!resourceError.value) hydrate(resource.data.value); }
  catch (error) { refreshError.value = error.message || "Model routing could not be loaded."; }
}
</script>

<template>
  <section class="model-routing" aria-label="Model routing">
    <div class="model-routing__body">
      <p class="text-title-large mb-2">{{ proposalMode ? `${connectionLabel || connectionId} connected` : `${engineLabel} routing` }}</p>
      <p v-if="proposalMode" class="text-body-medium mb-4">Your connection is ready. Model changes are optional.</p>
      <p v-else class="text-body-small mb-4">Used by all chats with {{ engineLabel }}.</p>
      <v-alert v-if="setupError" type="warning" variant="tonal" class="mb-4">Your AI is connected, but its routing defaults could not be saved. {{ setupError }} Review the choices below to finish setup.</v-alert>
      <v-skeleton-loader v-if="resource.isInitialLoading.value || baseRevision === null && !loadError" type="list-item-two-line@5, actions" />
      <v-alert v-else-if="loadError" type="error" variant="tonal">{{ loadError }} <v-btn variant="text" @click="reload">Retry</v-btn></v-alert>
      <v-alert v-else-if="engine?.error && !engine.connected" type="error" variant="tonal">{{ engine.error }} <v-btn variant="text" @click="reload">Retry</v-btn></v-alert>
      <template v-else-if="engine?.connected">
        <v-alert v-if="stale" type="warning" variant="tonal" class="mb-4">Routing changed in another tab. Your draft is retained. <v-btn variant="text" @click="reload">Reload current choices</v-btn></v-alert>
        <template v-if="proposalMode">
          <p class="text-title-medium mt-4">{{ engineLabel }}</p>
          <template v-if="suggestedChanges.length">
            <p v-if="!suggestedChanges.some(change => change.role === 'senior')" class="text-body-small">Senior stays {{ selectionLabel(engine.roles.senior.assignment) }}.</p>
            <v-checkbox v-for="proposal in suggestedChanges" :key="proposal.id" v-model="proposals" :value="proposal.id" :disabled="saving || !canEdit" hide-details>
              <template #label><span class="text-body-medium"><strong>{{ proposal.label }}</strong><br>Current: {{ selectionLabel(proposal.previous) }}<br>Suggested: {{ selectionLabel(proposal.proposed) }} · {{ choiceFor(proposal.proposed, proposal.role)?.accessLabel }}<br><span v-if="proposal.previous?.selectionSource === 'explicit'" class="text-body-small">You chose the current model. Select this change to replace it.</span></span></template>
            </v-checkbox>
          </template>
          <p v-if="!suggestedChanges.length" class="text-body-medium">No model changes are suggested.</p>
          <v-btn v-if="canEdit" variant="text" class="my-3" :disabled="saving" @click="customize">Configure {{ engineLabel }} routing</v-btn>
        </template>
        <template v-if="!proposalMode">
          <v-alert v-if="engine?.error" type="warning" variant="tonal" class="mb-4">{{ engine.error }}</v-alert>
          <v-btn v-if="canEdit && recommendedChanges.length" variant="outlined" color="primary" size="small" min-height="36" class="mb-4" :disabled="saving || stale" @click="reviewRecommendations">Review recommendations</v-btn>
          <p v-else-if="canEdit" class="text-body-small mb-4" role="status">No recommended changes.</p>
          <v-alert v-if="otherModelsRequested && otherModels.loadError.value" type="warning" variant="tonal" class="mb-4">
            Additional model choices could not load. {{ otherModels.loadError.value }}
            <v-btn variant="text" @click="otherModels.resource.reload()">Retry</v-btn>
          </v-alert>
          <template v-for="role in roles" :key="`${selectedEngine}-${role.id}`">
            <h3 class="text-title-medium mb-3">{{ role.id === 'sharedBackup' ? 'Fallback for personal models' : role.label }}</h3>
            <div class="model-routing__role mb-4" :class="{ 'model-routing__role--compact': smAndDown }">
              <v-autocomplete
                :ref="field => roleFields[role.id] = field" :model-value="choiceId(draft[selectedEngine]?.[role.id])" :items="items(role.id)" item-title="label" item-value="id" :label="role.label" variant="outlined" :disabled="saving || !canEdit" :hint="roleHint(role)" persistent-hint :error-messages="roleError(role.id)"
                :filter-keys="['title', 'raw.agent', 'props.subtitle']" no-data-text="No matching models" class="model-routing__model"
                :loading="otherModelsRequested && role.crossOrchestrator && otherModels.resource.isInitialLoading.value"
                @update:menu="open => { if (open && role.crossOrchestrator) otherModelsRequested = true; }"
                @update:model-value="choose(role.id, $event)"
              >
                <template #subheader="{ props: group }"><v-list-subheader class="model-routing__group">{{ group.label }}</v-list-subheader></template>
                <template #item="{ props: itemProps, item }">
                  <v-list-item v-bind="itemProps" role="option" :aria-label="[item.agent, item.label, item.props?.subtitle, item.status, item.recommended ? 'Recommended' : ''].filter(Boolean).join(' · ')" class="model-routing__option" :class="{ 'model-routing__option--model': item.id }" :min-height="item.id ? 68 : 44">
                    <template #title>
                      <div class="model-routing__option-title">
                        <span class="model-routing__model-name">{{ item.label }}</span>
                        <v-chip v-if="item.recommended" size="x-small" color="primary" variant="tonal">Recommended</v-chip>
                        <span v-if="item.status" class="text-body-small">{{ item.status }}</span>
                      </div>
                    </template>
                    <template #append="{ isSelected }"><v-icon v-if="isSelected" icon="$complete" color="primary" size="small" aria-hidden="true" /></template>
                  </v-list-item>
                </template>
                <template #selection="{ item }">
                  <span class="model-routing__selection">
                    <span class="model-routing__model-name">{{ item.label }}</span>
                    <span v-if="item.agent" class="text-body-small model-routing__selection-detail">{{ item.agent }}<template v-if="item.props.subtitle"> · {{ item.props.subtitle }}</template></span>
                  </span>
                </template>
              </v-autocomplete>
              <v-select v-if="variants(role.id).length" :model-value="draft[selectedEngine]?.[role.id]?.variantId || ''" :items="[{ id: '', label: 'Default' }, ...variants(role.id)]" item-title="label" item-value="id" :label="`${role.label} thinking`" variant="outlined" hide-details :disabled="saving || !canEdit" @update:model-value="changeEffort(role.id, $event)" />
            </div>
            <v-alert v-if="role.id === 'helper' && engine?.helperRoutingReview" type="warning" variant="tonal" class="mb-4">
              <template v-if="reviewedHelpers.includes(selectedEngine)">Helper choice confirmed. Save routing to apply.</template>
              <template v-else>
                Earlier settings used different models for helper tasks. Confirm the Helper selected above for future background tasks.
                <v-btn variant="outlined" class="mt-2" :disabled="saving || !canEdit || !draft[selectedEngine]?.helper" @click="reviewedHelpers = [selectedEngine]">Confirm Helper</v-btn>
              </template>
            </v-alert>
          </template>
        </template>
        <v-alert v-if="previewError" type="warning" variant="tonal">{{ previewError }} <v-btn variant="text" @click="retryPreview++">Retry preview</v-btn></v-alert>
      </template>
      <p v-else class="text-body-medium">{{ engineLabel ? `Connect a model to ${engineLabel} to configure its routing.` : 'Connect an assistant account to configure its modes.' }}</p>
    </div>
    <div class="d-flex justify-end flex-wrap ga-2 pt-4">
      <v-btn variant="text" :disabled="saving" @click="emit('close')">{{ proposalMode ? suggestedChanges.length ? 'Keep current routing' : 'Done' : 'Cancel' }}</v-btn>
      <v-btn v-if="canEdit && (proposalMode ? suggestedChanges.length : engine?.connected)" variant="flat" color="primary" :disabled="saving || stale || previewPending || Boolean(loadError) || baseRevision === null || !engines.length || Boolean(proposalMode && !proposals.length)" @click="save">{{ saving ? 'Saving…' : proposalMode ? `Apply ${proposals.length} ${proposals.length === 1 ? 'change' : 'changes'}` : 'Save routing' }}</v-btn>
    </div>
    <v-dialog v-if="canEdit" :model-value="Boolean(recommendationReview)" max-width="36rem" scrollable aria-label="Recommended model changes" @update:model-value="!$event && (recommendationReview = null)">
      <v-card v-if="recommendationReview" rounded="xl" title="Recommended changes">
        <v-card-text>
          <v-alert v-if="stale" type="warning" variant="tonal" class="mb-4">Routing changed. Close this review and reload current choices.</v-alert>
          <ul class="model-routing__changes pl-4">
            <li v-for="change in recommendationReview.changes" :key="change.role" class="text-body-medium py-1"><strong>{{ change.label }}</strong> → {{ change.description }}</li>
          </ul>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="recommendationReview = null">Cancel</v-btn>
          <v-btn variant="flat" color="primary" :disabled="saving || stale" @click="useRecommendations">Apply to form</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<style scoped>
.model-routing { min-width: 0; display: flex; flex-direction: column; max-height: calc(100dvh - 96px); }
.model-routing__body { overflow-y: auto; min-height: 0; padding-top: 4px; }
.model-routing__role { display: grid; grid-template-columns: minmax(0, 1fr) minmax(120px, .4fr); gap: 12px; align-items: start; }
.model-routing__role--compact { grid-template-columns: minmax(0, 1fr); }
.model-routing__changes { overflow-wrap: anywhere; }
.model-routing__group { font-weight: 600; color: rgb(var(--v-theme-on-surface)); background: rgba(var(--v-theme-on-surface), .04); }
.model-routing__option--model { padding-inline-start: 32px; }
.model-routing__option-title { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; white-space: normal; }
.model-routing__model-name { font-weight: 500; overflow-wrap: anywhere; }
.model-routing__option :deep(.v-list-item-subtitle) { margin-top: 4px; line-height: 1.4; opacity: .75; color: rgb(var(--v-theme-on-surface)); }
.model-routing__selection { display: flex; flex-direction: column; min-width: 0; padding-block: 2px; }
.model-routing__selection-detail { opacity: .75; }
.model-routing__model :deep(.v-autocomplete__selection) { max-width: 100%; }
</style>
