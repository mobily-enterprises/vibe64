<script setup>
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useDisplay } from "vuetify";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { defineVibe64AssistantSelection } from "@local/vibe64-runtime/shared";
import { ASSISTANT_ROUTING_ASSIGNMENTS, ASSISTANT_ROUTING_ROLE_DEFINITIONS } from "@local/vibe64-runtime/shared/assistantRouting";
import { useModelRouting } from "../composables/useModelRouting.js";
import { ACCOUNTS_ENDPOINT } from "../lib/accountsGateApi.js";

const props = defineProps({ connectionId: { type: String, default: "" }, connectionLabel: { type: String, default: "" },
  connectionEngines: { type: Array, default: () => [] }, setupError: { type: String, default: "" },
  engineId: { type: String, default: "" }, focusRole: { type: String, default: "" }, readonly: Boolean });
const emit = defineEmits(["close", "saved", "busy"]);
const { smAndDown } = useDisplay();
const { resource, engines, scopeKey, loadError: resourceError } = useModelRouting();
const refreshError = ref("");
const loadError = computed(() => resourceError.value || refreshError.value);
const draft = ref({});
const baseRevision = ref(null);
const selectedEngine = ref(props.engineId);
const recommendationReview = ref(null);
watch(selectedEngine, () => { recommendationReview.value = null; }, { flush: "sync" });
const proposals = ref([]);
const customizing = ref(false);
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
const proposalMode = computed(() => Boolean(props.connectionId) && !customizing.value);
const engine = computed(() => engines.value.find(({ engineId }) => engineId === selectedEngine.value));
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
  { id: "sharedBackup", label: "Shared backup" }];
function choiceId(selection) { return selection ? JSON.stringify([selection.engineId, selection.modelProviderId, selection.modelId]) : ""; }
function sameChoice(left, right) { return choiceId(left) === choiceId(right) && left?.variantId === right?.variantId && left?.agentId === right?.agentId; }
const recommendedChanges = computed(() => !engine.value ? [] : roles.flatMap(({ id, label }) => {
  const proposed = engine.value.roles[id].recommendation;
  const previous = draft.value[selectedEngine.value]?.[id];
  if (!proposed || sameChoice(previous, proposed)) return [];
  const choice = choiceFor(proposed, id);
  const changes = [];
  if (choiceId(previous) !== choiceId(proposed)) {
    changes.push(choice?.label || proposed.modelId);
    if (proposed.engineId !== (previous?.engineId || selectedEngine.value)) changes.push(choice?.engineLabel || proposed.engineId);
    if (previous?.modelId === proposed.modelId && previous?.modelProviderId !== proposed.modelProviderId) changes.push(choice?.providerLabel || proposed.modelProviderId);
  } else if ((previous?.agentId || "") !== (proposed.agentId || "")) changes.push(`${proposed.agentId || "default"} agent`);
  if ((previous?.variantId || "") !== (proposed.variantId || "")) changes.push(`${proposed.variantId || "default"} thinking`);
  return changes.length ? [{ role: id, label, proposed, description: changes.join(" · ") }] : [];
}));
const suggestedChanges = computed(() => engines.value
  .filter((item) => item.roles.senior.recommendation && item.roles.junior.recommendation)
  .flatMap((item) => ASSISTANT_ROUTING_ASSIGNMENTS.flatMap((role) => {
  const { assignment, recommendation } = item.roles[role];
  if (!recommendation || recommendation.modelProviderId !== props.connectionId ||
      props.connectionEngines.length && !props.connectionEngines.includes(recommendation.engineId) || sameChoice(assignment, recommendation)) return [];
  return [{ id: `${item.engineId}:${role}`, engineId: item.engineId,
    role, label: roles.find(({ id }) => id === role).label, previous: assignment, proposed: recommendation }];
})));
function payload() {
  const orchestrators = JSON.parse(JSON.stringify(draft.value));
  if (proposalMode.value) for (const proposal of suggestedChanges.value) {
    if (proposals.value.includes(proposal.id)) orchestrators[proposal.engineId][proposal.role] = proposal.proposed;
  }
  const changes = Object.fromEntries(Object.entries(orchestrators).map(([engineId, assignments]) => [engineId,
    Object.fromEntries(Object.entries(assignments).filter(([role, selection]) => !sameChoice(selection, savedAssignments[engineId]?.[role])))
  ]).filter(([, assignments]) => Object.keys(assignments).length));
  return { revision: baseRevision.value, orchestrators: changes, reviewedHelperWorkflows: reviewedHelpers.value };
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
  savedPayload = JSON.stringify({ revision: data.revision, orchestrators: {}, reviewedHelperWorkflows: [] });
  if (!data.engines.some(({ engineId }) => engineId === selectedEngine.value)) selectedEngine.value = data.engines[0]?.engineId || "";
  proposals.value = suggestedChanges.value.filter(({ previous }) => !previous || previous.selectionSource === "recommended").map(({ id }) => id);
  if (proposalMode.value && suggestedChanges.value.length) selectedEngine.value = suggestedChanges.value[0].engineId;
  preview.value = data;
  hydratedDraft = draftSnapshot();
}
watch(scopeKey, () => {
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
  return engines.value.flatMap((item) => item.roles[role]?.choices || []).find((item) => choiceId(item) === choiceId(selection));
}
function selectionLabel(selection) {
  if (!selection) return "No model selected";
  const choice = choiceFor(selection, "router");
  return `${choice?.label || selection.modelId} · ${choice?.engineLabel || selection.engineId} / ${choice?.providerLabel || selection.modelProviderId}${selection.variantId ? ` · ${selection.variantId} thinking` : ""}`;
}
function items(role) {
  const choices = (engine.value?.roles[role]?.choices || []).map((choice) => ({
    id: choiceId(choice), label: `${choice.label} · ${choice.engineLabel} / ${choice.providerLabel}`,
    props: { subtitle: `${choice.providerLabel} · ${choice.accessLabel}${choice.compatibilityError ? " · Compatibility pending" : ""}`,
      disabled: !choice.available || Boolean(choice.compatibilityError) || ["junior", "sharedBackup"].includes(role) && choice.capabilities?.toolcall === false }
  }));
  const current = draft.value[selectedEngine.value]?.[role];
  if (current && !choices.some(({ id }) => id === choiceId(current))) choices.unshift({ id: choiceId(current), label: selectionLabel(current), props: { subtitle: "Unavailable saved choice", disabled: true } });
  return [{ id: "", label: role === "sharedBackup" ? "No shared backup" : "Choose a model" }, ...choices];
}
function choose(role, id) {
  const choice = engine.value.roles[role].choices.find((item) => choiceId(item) === id);
  draft.value[selectedEngine.value][role] = choice ? { ...defineVibe64AssistantSelection(choice), selectionSource: "explicit" } : null;
  delete fieldErrors.value[`${selectedEngine.value}.${role}`];
}
function changeEffort(role, variantId) {
  draft.value[selectedEngine.value][role] = { ...draft.value[selectedEngine.value][role], variantId, selectionSource: "explicit" };
  delete fieldErrors.value[`${selectedEngine.value}.${role}`];
}
function variants(role) { return choiceFor(draft.value[selectedEngine.value]?.[role], role)?.variants || []; }
function roleHint(role) {
  if (role.id === "sharedBackup") return "";
  if (stale.value) return "Reload current choices to check access.";
  if (previewPending.value) return "Checking access…";
  if (previewError.value) return "Access could not be checked.";
  const decision = decisions.value[role.id === "router" ? "request_routing" : role.id];
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
  for (const [engineId, assignments] of Object.entries(payload().orchestrators)) Object.assign(draft.value[engineId], assignments);
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
  if (saving.value || stale.value || !canEdit.value || previewPending.value) return;
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
      <p class="text-title-large mb-2">{{ proposalMode ? `${connectionLabel || connectionId} connected` : 'Model routing' }}</p>
      <p v-if="proposalMode" class="text-body-medium mb-4">Your connection is ready. Model changes are optional.</p>
      <v-alert v-if="setupError" type="warning" variant="tonal" class="mb-4">Your AI is connected, but its routing defaults could not be saved. {{ setupError }} Review the choices below to finish setup.</v-alert>
      <v-skeleton-loader v-if="resource.isInitialLoading.value || baseRevision === null && !loadError" type="list-item-two-line@5, actions" />
      <v-alert v-else-if="loadError" type="error" variant="tonal">{{ loadError }} <v-btn variant="text" @click="reload">Retry</v-btn></v-alert>
      <template v-else-if="engines.length">
        <v-alert v-if="stale" type="warning" variant="tonal" class="mb-4">Routing changed in another tab. Your draft is retained. <v-btn variant="text" @click="reload">Reload current choices</v-btn></v-alert>
        <v-select v-if="!proposalMode" v-model="selectedEngine" :items="engines" item-title="label" item-value="engineId" :item-props="item => ({ subtitle: item.connected === false ? 'Needs reconnection' : '' })" label="Workflow orchestrator" variant="outlined" hide-details class="mt-4 mb-2" :disabled="saving" />
        <template v-if="proposalMode">
          <template v-for="workflow in engines.filter(item => suggestedChanges.some(change => change.engineId === item.engineId))" :key="workflow.engineId">
            <p class="text-title-medium mt-4">{{ workflow.label }}</p>
            <p v-if="!suggestedChanges.some(change => change.engineId === workflow.engineId && change.role === 'senior')" class="text-body-small">Senior stays {{ selectionLabel(workflow.roles.senior.assignment) }}.</p>
            <v-checkbox v-for="proposal in suggestedChanges.filter(item => item.engineId === workflow.engineId)" :key="proposal.id" v-model="proposals" :value="proposal.id" :disabled="saving || !canEdit" hide-details>
              <template #label><span class="text-body-medium"><strong>{{ proposal.label }}</strong><br>Current: {{ selectionLabel(proposal.previous) }}<br>Suggested: {{ selectionLabel(proposal.proposed) }} · {{ choiceFor(proposal.proposed, proposal.role)?.accessLabel }}<br><span v-if="proposal.previous?.selectionSource === 'explicit'" class="text-body-small">You chose the current model. Select this change to replace it.</span></span></template>
            </v-checkbox>
          </template>
          <p v-if="!suggestedChanges.length" class="text-body-medium">No model changes are suggested. Use Customize routing to choose assignments.</p>
          <v-btn v-if="canEdit" variant="text" class="my-3" @click="customize">Customize routing</v-btn>
        </template>
        <template v-if="!proposalMode">
          <v-alert v-if="engine?.error" type="warning" variant="tonal" class="mb-4">{{ engine.error }}</v-alert>
          <v-btn v-if="canEdit" variant="outlined" color="primary" size="small" min-height="36" class="mb-4" :disabled="saving || stale || !recommendedChanges.length" @click="reviewRecommendations">Review recommendations</v-btn>
          <template v-for="role in roles" :key="`${selectedEngine}-${role.id}`">
            <h3 class="text-title-medium mb-3">{{ role.id === 'sharedBackup' ? 'Fallback for personal models' : role.label }}</h3>
            <div class="model-routing__role mb-4" :class="{ 'model-routing__role--compact': smAndDown }">
              <v-autocomplete :ref="field => roleFields[role.id] = field" :model-value="choiceId(draft[selectedEngine]?.[role.id])" :items="items(role.id)" item-title="label" item-value="id" :label="role.label" variant="outlined" :disabled="saving || !canEdit" :hint="roleHint(role)" persistent-hint :error-messages="roleError(role.id)" @update:model-value="choose(role.id, $event)" />
              <v-select v-if="variants(role.id).length" :model-value="draft[selectedEngine]?.[role.id]?.variantId || ''" :items="[{ id: '', label: 'Default' }, ...variants(role.id)]" item-title="label" item-value="id" :label="`${role.label} thinking`" variant="outlined" hide-details :disabled="saving || !canEdit" @update:model-value="changeEffort(role.id, $event)" />
            </div>
            <v-alert v-if="role.id === 'intern' && engine?.helperRoutingReview" type="warning" variant="tonal" class="mb-4">
              Older helpers used {{ engine.helperRoutingReview.previous.map(item => `${item.modelId} (${item.engineId})`).join(', ') }}. Choose Intern for future helpers.
              <v-checkbox v-model="reviewedHelpers" :value="selectedEngine" label="I reviewed the Intern choice for helpers" :disabled="saving || !canEdit || !draft[selectedEngine]?.intern" hide-details />
            </v-alert>
          </template>
        </template>
        <v-alert v-if="previewError" type="warning" variant="tonal">{{ previewError }} <v-btn variant="text" @click="retryPreview++">Retry preview</v-btn></v-alert>
      </template>
      <p v-else class="text-body-medium">Connect an assistant account to configure its modes.</p>
    </div>
    <div class="d-flex justify-end flex-wrap ga-2 pt-4">
      <v-btn variant="text" :disabled="saving" @click="emit('close')">{{ proposalMode ? suggestedChanges.length ? 'Keep current routing' : 'Done' : 'Cancel' }}</v-btn>
      <v-btn v-if="canEdit && (!proposalMode || suggestedChanges.length)" variant="flat" color="primary" :disabled="saving || stale || previewPending || Boolean(loadError) || baseRevision === null || !engines.length || Boolean(proposalMode && !proposals.length)" @click="save">{{ saving ? 'Saving…' : proposalMode ? `Apply ${proposals.length} ${proposals.length === 1 ? 'change' : 'changes'}` : 'Save routing' }}</v-btn>
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
</style>
