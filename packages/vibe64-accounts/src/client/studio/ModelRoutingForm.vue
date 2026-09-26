<script setup>
import { computed, onMounted, ref, watch } from "vue";
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
  engineId: { type: String, default: "" }, readonly: Boolean });
const emit = defineEmits(["close", "saved", "busy"]);
const { smAndDown } = useDisplay();
const { resource, engines, scopeKey, loadError: resourceError } = useModelRouting();
const refreshError = ref("");
const loadError = computed(() => resourceError.value || refreshError.value);
const draft = ref({});
const baseRevision = ref(null);
const selectedEngine = ref(props.engineId);
const proposals = ref([]);
const customizing = ref(false);
const saving = ref(false);
const fieldErrors = ref({});
const reviewedHelpers = ref([]);
const preview = ref(null);
const previewPending = ref(false);
const previewError = ref("");
const audience = ref("owner");
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
const stale = computed(() => baseRevision.value !== null && resource.data.value?.revision !== baseRevision.value);
const roles = [...ASSISTANT_ROUTING_ROLE_DEFINITIONS, { id: "sharedBackup", label: "Shared backup",
  description: "Used when a collaborator cannot use a personal connection. Never used for outages or quota errors." }];
const previewRows = [{ id: "senior", label: "Senior" }, { id: "junior", label: "Junior" }, { id: "review", label: "Auto review and Deslop" },
  { id: "intern", label: "Intern chat" }, { id: "prompt_hint", label: "Suggestions and helpers" },
  { id: "request_routing", label: "Router" }, { id: "auto", label: "Auto" }];
function choiceId(selection) { return selection ? JSON.stringify([selection.engineId, selection.modelProviderId, selection.modelId]) : ""; }
function sameChoice(left, right) { return choiceId(left) === choiceId(right) && left?.variantId === right?.variantId && left?.agentId === right?.agentId; }
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
const decisions = computed(() => {
  const purposes = previewEngine.value?.preview?.[canEdit.value ? audience.value : "viewer"] || {};
  return { ...purposes, review: purposes.auto?.available === false ? purposes.auto : purposes.review };
});
const hasEdits = computed(() => previewPayload.value !== savedPayload);
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
  const scope = choiceFor(draft.value[selectedEngine.value]?.[role.id], role.id)?.accessLabel;
  const description = role.id === "intern" ? "Economical chat, suggestions, explanations, and naming." : role.description;
  return scope ? `${scope} · ${description}` : description;
}
function roleError(role) {
  if (fieldErrors.value[`${selectedEngine.value}.${role}`]) return fieldErrors.value[`${selectedEngine.value}.${role}`];
  const state = previewEngine.value?.roles[role];
  return !previewPending.value && sameChoice(state?.assignment, draft.value[selectedEngine.value]?.[role]) ? state?.error || "" : "";
}
function useRecommendations() {
  for (const role of ASSISTANT_ROUTING_ASSIGNMENTS) if (engine.value.roles[role].recommendation) draft.value[selectedEngine.value][role] = engine.value.roles[role].recommendation;
}
function customize() {
  for (const [engineId, assignments] of Object.entries(payload().orchestrators)) Object.assign(draft.value[engineId], assignments);
  customizing.value = true;
}
function decisionReason(role) {
  const decision = decisions.value[role];
  if (!decision?.available) return decision?.message || "Choose the models above to see the result.";
  if (role === "review" && sameChoice(decision.effectiveSelection, decisions.value.junior?.effectiveSelection)) return "Same model checks its coding work.";
  if (decision.backupReason === "keep_workflow_together") return "Shared backup keeps Senior and Junior in the same orchestrator.";
  if (decision.backupUsed) return "Shared backup: the configured model uses a personal connection.";
  return role === "review" ? "Senior reviews, fixes issues and Deslops in Auto." : "";
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
      <p class="text-body-medium mb-4">{{ proposalMode ? 'Review how this connection can help. Your existing choices stay until you apply changes.' : 'Choose Senior, Junior, Intern and Router models for each orchestrator.' }}</p>
      <v-alert v-if="setupError" type="warning" variant="tonal" class="mb-4">Your AI is connected, but its routing defaults could not be saved. {{ setupError }} Review the choices below to finish setup.</v-alert>
      <v-skeleton-loader v-if="resource.isInitialLoading.value || baseRevision === null && !loadError" type="list-item-two-line@5, actions" />
      <v-alert v-else-if="loadError" type="error" variant="tonal">{{ loadError }} <v-btn variant="text" @click="reload">Retry</v-btn></v-alert>
      <template v-else-if="engines.length">
        <v-alert v-if="stale" type="warning" variant="tonal" class="mb-4">Routing changed in another tab. Your draft is retained. <v-btn variant="text" @click="reload">Reload current choices</v-btn></v-alert>
        <template v-if="proposalMode">
          <template v-for="workflow in engines.filter(item => suggestedChanges.some(change => change.engineId === item.engineId))" :key="workflow.engineId">
            <p class="text-title-medium mt-4">{{ workflow.label }}</p>
            <p v-if="!suggestedChanges.some(change => change.engineId === workflow.engineId && change.role === 'senior')" class="text-body-small">Senior stays {{ selectionLabel(workflow.roles.senior.assignment) }}.</p>
            <v-checkbox v-for="proposal in suggestedChanges.filter(item => item.engineId === workflow.engineId)" :key="proposal.id" v-model="proposals" :value="proposal.id" :disabled="saving || !canEdit" hide-details>
              <template #label><span class="text-body-medium"><strong>{{ proposal.label }}</strong><br>{{ selectionLabel(proposal.previous) }} → {{ selectionLabel(proposal.proposed) }}<br><span v-if="proposal.previous?.selectionSource === 'explicit'" class="text-body-small">Custom choice — change only if selected.</span></span></template>
            </v-checkbox>
          </template>
          <p v-if="!suggestedChanges.length" class="text-body-medium">No recommended changes. Your current assignments remain preferred, or this connection has no compatible improvement.</p>
          <v-btn v-if="canEdit" variant="text" class="my-3" @click="customize">Customize routing</v-btn>
        </template>
        <v-select v-model="selectedEngine" :items="engines" item-title="label" item-value="engineId" label="Workflow orchestrator" variant="outlined" hide-details class="my-4" :disabled="saving" />
        <template v-if="!proposalMode">
          <v-alert v-if="engine?.error" type="warning" variant="tonal" class="mb-4">{{ engine.error }}</v-alert>
          <v-btn v-if="canEdit" variant="text" class="mb-3" :disabled="saving" @click="useRecommendations">Use recommended choices</v-btn>
          <template v-for="role in roles" :key="`${selectedEngine}-${role.id}`">
            <div v-if="role.id === 'senior'" class="mb-4"><p class="text-title-medium">Senior and Junior</p><p class="text-body-small">Direct conversations stay with your chosen model. In Auto, Senior plans and reviews; Junior implements. One orchestrator keeps their context together.</p></div>
            <div v-if="role.id === 'intern'" class="mb-4"><p class="text-title-medium">Independent assistance</p><p class="text-body-small">These models can use any connected orchestrator.</p></div>
            <div v-if="role.id === 'sharedBackup'" class="mb-4"><p class="text-title-medium">Collaborator access</p><p class="text-body-small">A backup on another orchestrator moves both Senior and Junior there.</p></div>
            <div class="model-routing__role mb-4" :class="{ 'model-routing__role--compact': smAndDown }">
              <v-autocomplete :model-value="choiceId(draft[selectedEngine]?.[role.id])" :items="items(role.id)" item-title="label" item-value="id" :label="role.label" variant="outlined" :disabled="saving || !canEdit" :hint="roleHint(role)" persistent-hint :error-messages="roleError(role.id)" @update:model-value="choose(role.id, $event)" />
              <v-select v-if="variants(role.id).length" :model-value="draft[selectedEngine]?.[role.id]?.variantId || ''" :items="[{ id: '', label: 'Default' }, ...variants(role.id)]" item-title="label" item-value="id" :label="`${role.label} thinking`" variant="outlined" hide-details :disabled="saving || !canEdit" @update:model-value="changeEffort(role.id, $event)" />
            </div>
            <v-alert v-if="role.id === 'intern' && engine?.helperRoutingReview" type="warning" variant="tonal" class="mb-4">
              Older helpers used {{ engine.helperRoutingReview.previous.map(item => `${item.modelId} (${item.engineId})`).join(', ') }}. Choose Intern for future helpers.
              <v-checkbox v-model="reviewedHelpers" :value="selectedEngine" label="I reviewed the Intern choice for helpers" :disabled="saving || !canEdit || !draft[selectedEngine]?.intern" hide-details />
            </v-alert>
          </template>
          <p v-if="!draft[selectedEngine]?.sharedBackup" class="text-body-small mb-4">Connect a shared model and choose it as backup to allow collaborators to use personal Senior, Junior, or Intern assignments.</p>
        </template>
        <div class="model-routing__preview mt-4" :aria-busy="previewPending ? 'true' : undefined">
          <p class="text-title-medium mb-2">What people will use <span class="text-body-small">· {{ hasEdits ? 'Unsaved preview' : 'Saved routing' }}</span></p>
          <v-btn-toggle v-if="canEdit" v-model="audience" mandatory variant="outlined" divided class="mb-3" aria-label="Preview audience"><v-btn value="owner">Owner</v-btn><v-btn value="collaborator">Collaborator</v-btn></v-btn-toggle>
          <v-skeleton-loader v-if="previewPending" type="list-item-two-line@7" />
          <v-alert v-else-if="previewError || stale" type="warning" variant="tonal">{{ stale ? 'Reload current choices to refresh this preview.' : previewError }} <v-btn v-if="!stale" variant="text" @click="retryPreview++">Retry preview</v-btn></v-alert>
          <dl v-else class="model-routing__results">
            <div v-for="row in previewRows" :key="row.id" class="py-2">
              <dt class="text-label-large">{{ row.label }}</dt>
              <dd class="text-body-medium">{{ decisions[row.id]?.available ? row.id === 'auto' ? 'Available · Senior plans; approve Junior implementation' : selectionLabel(decisions[row.id].effectiveSelection) : 'Unavailable' }}<p v-if="decisionReason(row.id)" class="text-body-small">{{ decisionReason(row.id) }}</p></dd>
            </div>
          </dl>
        </div>
        <p class="text-body-small mt-4">Changes apply to new requests. Current turns keep their captured models. Each connection uses its own API credit or subscription allowance.</p>
      </template>
      <p v-else class="text-body-medium">Connect an assistant account to configure its modes.</p>
    </div>
    <div class="d-flex justify-end flex-wrap ga-2 pt-4">
      <v-btn variant="text" :disabled="saving" @click="emit('close')">{{ proposalMode ? suggestedChanges.length ? 'Keep current routing' : 'Done' : 'Cancel' }}</v-btn>
      <v-btn v-if="canEdit && (!proposalMode || suggestedChanges.length)" variant="flat" color="primary" :disabled="saving || stale || previewPending || Boolean(loadError) || baseRevision === null || !engines.length || Boolean(proposalMode && !proposals.length)" @click="save">{{ saving ? 'Saving…' : proposalMode ? `Apply ${proposals.length} ${proposals.length === 1 ? 'change' : 'changes'}` : 'Save routing' }}</v-btn>
    </div>
  </section>
</template>

<style scoped>
.model-routing { min-width: 0; display: flex; flex-direction: column; max-height: calc(100dvh - 96px); }
.model-routing__body { overflow-y: auto; min-height: 0; padding-top: 4px; }
.model-routing__role { display: grid; grid-template-columns: minmax(0, 1fr) minmax(120px, .4fr); gap: 12px; align-items: start; }
.model-routing__role--compact { grid-template-columns: minmax(0, 1fr); }
.model-routing__results dd { margin: 0; overflow-wrap: anywhere; }
.model-routing__preview { min-height: 26rem; }
</style>
