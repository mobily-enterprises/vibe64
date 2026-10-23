<script setup>
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useDisplay } from "vuetify";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { defineVibe64AssistantSelection, vibe64AssistantSelectionLabel } from "@local/vibe64-runtime/shared";
import { ASSISTANT_FOLLOWING_ROLES, ASSISTANT_ROLE_PURPOSES, ASSISTANT_ROUTING_ROLE_DEFINITIONS, ASSISTANT_SETUP_ROLES,
  assistantModeLabel } from "@local/vibe64-runtime/shared/assistantRouting";
import { useModelRouting } from "../composables/useModelRouting.js";
import { ACCOUNTS_ENDPOINT } from "../lib/accountsGateApi.js";
import AiPersonalUse from "./AiPersonalUse.vue";

const props = defineProps({ connectionId: { type: String, default: "" }, connectionLabel: { type: String, default: "" },
  setupError: { type: String, default: "" }, focusRole: { type: String, default: "" }, readonly: Boolean,
  // Inside onboarding: model display names and plain role names, no heading.
  plain: Boolean });
const emit = defineEmits(["close", "saved", "busy"]);
const { smAndDown } = useDisplay();
const SETUPS = [{ id: "owner", label: "Your AI setup", audience: "You" }, { id: "nonOwner", label: "Team members", audience: "Team members" }];
const customizing = ref(false);
const proposalMode = computed(() => Boolean(props.connectionId) && !customizing.value);
const { resource, engines, setups, scopeKey, loadError: resourceError } = useModelRouting();
const refreshError = ref("");
const loadError = computed(() => resourceError.value || refreshError.value);
// draft[setup][role]: a selection, null (off) or { follows }; absent roles stay absent.
const draft = ref({ owner: {}, nonOwner: {} });
const baseRevision = ref(null);
const recommendationReview = ref(null);
const proposals = ref([]);
const saving = ref(false);
const fieldErrors = ref({});
const preview = ref(null);
const previewPending = ref(false);
const previewError = ref("");
const retryPreview = ref(0);
const refreshingConnection = ref(Boolean(props.connectionId));
let savedPayload = "";
let savedValues = { owner: {}, nonOwner: {} };
let hydratedDraft = "";
const draftSnapshot = () => JSON.stringify({ draft: draft.value, proposals: proposals.value, customizing: customizing.value });
const canEdit = computed(() => !props.readonly && resource.data.value?.canConfigure === true);
const connected = computed(() => engines.value.some((engine) => engine.connected));
const roleFields = ref({});
watch([setups, () => props.focusRole], async () => {
  if (!props.focusRole) return;
  await nextTick();
  const field = roleFields.value[`owner.${props.focusRole}`]?.$el;
  field?.scrollIntoView({ block: "center" });
  field?.querySelector('input[role="combobox"]')?.focus({ preventScroll: true });
}, { immediate: true });
const stale = computed(() => baseRevision.value !== null && resource.data.value?.revision !== baseRevision.value);
const rolesFor = (setup) => ASSISTANT_ROUTING_ROLE_DEFINITIONS.filter(({ id }) => ASSISTANT_SETUP_ROLES[setup].includes(id));
const visibleSetups = computed(() => SETUPS.filter(({ id }) => id === "owner" || canEdit.value));
function choiceId(value) {
  if (value?.follows) return `follows:${value.follows}`;
  return value?.schema ? JSON.stringify([value.engineId, value.modelProviderId, value.modelId]) : "";
}
function sameValue(left, right) {
  return choiceId(left) === choiceId(right) && left?.variantId === right?.variantId && left?.agentId === right?.agentId;
}
const roleState = (setup, role, data = resource.data.value) => data?.setups?.[setup]?.roles?.[role];
function choiceFor(setup, role, selection) {
  return (roleState(setup, role)?.choices || []).find((item) => choiceId(item) === choiceId(selection));
}
const PLAIN_ROLES = { senior: "Building", junior: "Quick tasks", quickHelper: "Background helpers", router: "Request routing" };
function selectionLabel(setup, role, value) {
  if (value?.follows) return `Same as ${assistantModeLabel(value.follows)}`;
  if (!value) return "No model selected";
  return props.plain ? choiceFor(setup, role, value)?.label || value.modelId : vibe64AssistantSelectionLabel(value);
}
const recommendedChanges = computed(() => visibleSetups.value.flatMap(({ id: setup }) => rolesFor(setup).flatMap(({ id, label }) => {
  const proposed = roleState(setup, id)?.recommendation;
  if (!proposed || sameValue(draft.value[setup][id], proposed)) return [];
  return [{ setup, role: id, label, proposed, description: selectionLabel(setup, id, proposed) }];
})));
// Onboarding proposals: owner roles whose recommendation moves onto this connection.
const suggestedChanges = computed(() => !connected.value ? [] : ASSISTANT_SETUP_ROLES.owner.flatMap((role) => {
  const { value, recommendation } = roleState("owner", role) || {};
  if (!recommendation?.schema || recommendation.modelProviderId !== props.connectionId || sameValue(value, recommendation)) return [];
  return [{ id: `owner:${role}`, setup: "owner", role, label: assistantModeLabel(role), previous: value?.schema ? value : null, proposed: recommendation }];
}));
function payload() {
  const values = JSON.parse(JSON.stringify(draft.value));
  if (proposalMode.value) for (const proposal of suggestedChanges.value) {
    if (proposals.value.includes(proposal.id)) values[proposal.setup][proposal.role] = proposal.proposed;
  }
  const changes = Object.fromEntries(SETUPS.map(({ id: setup }) => [setup, Object.fromEntries(Object.entries(values[setup])
    .filter(([role, value]) => !sameValue(value, savedValues[setup][role]) || (value === null) !== (savedValues[setup][role] === null)))])
    .filter(([, roles]) => Object.keys(roles).length));
  return { revision: baseRevision.value, ...changes };
}
function hydrate(data) {
  if (!data?.ok) return;
  recommendationReview.value = null;
  baseRevision.value = data.revision;
  draft.value = Object.fromEntries(SETUPS.map(({ id: setup }) => [setup, Object.fromEntries(ASSISTANT_SETUP_ROLES[setup]
    .filter((role) => roleState(setup, role, data)?.configured).map((role) => [role, roleState(setup, role, data).value]))]));
  fieldErrors.value = {};
  savedValues = JSON.parse(JSON.stringify(draft.value));
  savedPayload = JSON.stringify({ revision: data.revision });
  proposals.value = suggestedChanges.value.filter(({ previous }) => !previous || previous.selectionSource === "recommended").map(({ id }) => id);
  preview.value = data;
  hydratedDraft = draftSnapshot();
}
watch(scopeKey, () => {
  baseRevision.value = null;
  draft.value = { owner: {}, nonOwner: {} };
  savedValues = { owner: {}, nonOwner: {} };
  proposals.value = [];
  preview.value = null;
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
function items(setup, role) {
  const current = draft.value[setup][role];
  const state = roleState(setup, role);
  const choices = (state?.choices || []).map((choice) => {
    const status = choice.compatibilityError ? "Compatibility pending" : !choice.available ? "Unavailable"
      : ["junior", "fix"].includes(role) && choice.capabilities?.toolcall === false ? "Tools unavailable" : "";
    const personal = choice.available === true && choice.ownerOnly !== false;
    return { id: choiceId(choice), engineId: choice.engineId, agent: choice.engineLabel || choice.engineId, label: choice.label || choice.modelId, status, personal,
      access: choice.accessLabel, recommended: !status && choiceId(choice) === choiceId(state.recommendation),
      props: { subtitle: personal ? choice.providerLabel : `${choice.providerLabel} · ${choice.accessLabel}`, disabled: Boolean(status) } };
  });
  if (current?.schema && !choices.some(({ id }) => id === choiceId(current))) {
    choices.unshift({ id: choiceId(current), engineId: current.engineId, agent: current.engineId, label: current.modelId,
      status: "Unavailable saved choice", props: { disabled: true } });
  }
  // "Same as" another role of this setup that is itself a model choice.
  const follows = ASSISTANT_FOLLOWING_ROLES.includes(role) ? ASSISTANT_SETUP_ROLES[setup]
    .filter((target) => target !== role && !draft.value[setup][target]?.follows)
    .map((target) => ({ id: `follows:${target}`, label: `Same as ${assistantModeLabel(target)}`,
      recommended: state?.recommendation?.follows === target, props: {} })) : [];
  const groups = [...new Set(choices.map((choice) => choice.engineId))].flatMap((engineId) => {
    const models = choices.filter((choice) => choice.engineId === engineId);
    return [{ type: "subheader", id: `group:${engineId}`, label: models[0].agent }, ...models];
  });
  return [{ id: "", label: "Choose a model" }, ...follows, ...groups];
}
// Each personal provider the owner draft routes to, explained once above the roles.
const personalProviders = computed(() => [...new Set(ASSISTANT_SETUP_ROLES.owner.flatMap((role) => {
  const choice = choiceFor("owner", role, draft.value.owner[role]);
  return choice?.available === true && choice.ownerOnly !== false ? [choice.modelProviderId] : [];
}))]);
function choose(setup, role, id) {
  const choice = (roleState(setup, role)?.choices || []).find((item) => choiceId(item) === id);
  draft.value[setup][role] = id.startsWith("follows:") ? { follows: id.slice("follows:".length) }
    : choice ? { ...defineVibe64AssistantSelection(choice), selectionSource: "explicit" } : null;
  delete fieldErrors.value[`${setup}.${role}`];
}
function changeEffort(setup, role, variantId) {
  draft.value[setup][role] = { ...draft.value[setup][role], variantId, selectionSource: "explicit" };
  delete fieldErrors.value[`${setup}.${role}`];
}
function variants(setup, role) { return choiceFor(setup, role, draft.value[setup][role])?.variants || []; }
function roleHint(setup, role) {
  if (stale.value) return "Reload current choices to check access.";
  if (previewPending.value) return "Checking access…";
  if (previewError.value) return "Access could not be checked.";
  const decision = preview.value?.setups?.[setup]?.preview?.[ASSISTANT_ROLE_PURPOSES[role]];
  if (!decision) return "";
  const result = decision.available ? vibe64AssistantSelectionLabel(decision.effectiveSelection) : decision.message || "Unavailable";
  return `${SETUPS.find(({ id }) => id === setup).audience}: ${result}`;
}
function roleError(setup, role) {
  if (fieldErrors.value[`${setup}.${role}`]) return fieldErrors.value[`${setup}.${role}`];
  const state = preview.value?.setups?.[setup]?.roles?.[role];
  return !previewPending.value && sameValue(state?.value, draft.value[setup][role]) ? state?.error || "" : "";
}
function reviewRecommendations() {
  if (!canEdit.value || saving.value || stale.value || !recommendedChanges.value.length) return;
  recommendationReview.value = { changes: recommendedChanges.value };
}
function useRecommendations() {
  if (!recommendationReview.value || !canEdit.value || saving.value || stale.value) return;
  for (const { setup, role, proposed } of recommendationReview.value.changes) {
    draft.value[setup][role] = proposed;
    delete fieldErrors.value[`${setup}.${role}`];
  }
  recommendationReview.value = null;
}
function customize() {
  const changes = payload();
  for (const { id: setup } of SETUPS) if (changes[setup]) Object.assign(draft.value[setup], changes[setup]);
  customizing.value = true;
}
const command = useCommand({
  access: "never", apiSuffix: "/vibe64/accounts/model-routing",
  buildCommandOptions: () => ({ method: "PATCH", path: `${ACCOUNTS_ENDPOINT}/model-routing` }), buildRawPayload: payload,
  onRunSuccess(response) {
    fieldErrors.value = response?.fieldErrors || {};
    if (response?.ok !== true) throw new Error(response?.error || "Model routing was not saved.");
  },
  messages: { success: "AI setup saved. New requests will use these models.", error: "AI setup was not saved." },
  fallbackRunError: "AI setup was not saved.", ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
  placementSource: "vibe64.accounts.model-routing", surfaceId: "app", writeMethod: "PATCH"
});
async function save() {
  if (saving.value || stale.value || !canEdit.value || previewPending.value || !connected.value) return;
  saving.value = true;
  try { const result = await command.run(); if (result?.ok === true) { await resource.reload(); emit("saved"); } }
  catch { /* Shared command feedback reports errors; keep this draft and its field errors. */ }
  finally { saving.value = false; }
}
function until(ready) {
  return new Promise((resolve) => {
    const stop = watch(ready, (value) => { if (value) { queueMicrotask(() => stop()); resolve(); } }, { immediate: true });
  });
}
// Onboarding's plain "Yes": every suggestion for this connection, saved as usual.
async function applySuggested() {
  await until(() => loadError.value || baseRevision.value !== null && !refreshingConnection.value);
  if (loadError.value) return;
  proposals.value = suggestedChanges.value.map(({ id }) => id);
  if (!proposals.value.length) return emit("saved");
  await nextTick();
  await until(() => !previewPending.value);
  await save();
}
defineExpose({ applySuggested });
async function reload() {
  refreshError.value = "";
  try { await resource.reload(); if (!resourceError.value) hydrate(resource.data.value); }
  catch (error) { refreshError.value = error.message || "Model routing could not be loaded."; }
}
</script>

<template>
  <section class="model-routing" aria-label="Model routing">
    <div class="model-routing__body">
      <template v-if="!plain">
        <p class="text-title-large mb-2">{{ proposalMode ? `${connectionLabel || connectionId} connected` : "AI setup" }}</p>
        <p v-if="proposalMode" class="text-body-medium mb-4">Your connection is ready. Model changes are optional.</p>
        <p v-else class="text-body-small mb-4">Main chat always runs on the owner's setup.</p>
      </template>
      <v-alert v-if="setupError" type="warning" variant="tonal" class="mb-4">Your AI is connected, but its routing defaults could not be saved. {{ setupError }} Review the choices below to finish setup.</v-alert>
      <v-skeleton-loader v-if="resource.isInitialLoading.value || baseRevision === null && !loadError" type="list-item-two-line@5, actions" />
      <v-alert v-else-if="loadError" type="error" variant="tonal">{{ loadError }} <v-btn variant="text" @click="reload">Retry</v-btn></v-alert>
      <template v-else-if="connected">
        <v-alert v-if="stale" type="warning" variant="tonal" class="mb-4">Routing changed in another tab. Your draft is retained. <v-btn variant="text" @click="reload">Reload current choices</v-btn></v-alert>
        <template v-if="proposalMode">
          <template v-if="suggestedChanges.length">
            <p v-if="!suggestedChanges.some(change => change.role === 'senior')" class="text-body-small">{{ plain ? "Building" : "Senior" }} stays {{ selectionLabel('owner', 'senior', draft.owner.senior) }}.</p>
            <v-checkbox v-for="proposal in suggestedChanges" :key="proposal.id" v-model="proposals" :value="proposal.id" :disabled="saving || !canEdit" color="primary" hide-details class="model-routing__proposal">
              <template #label><span class="text-body-medium"><strong>{{ plain ? PLAIN_ROLES[proposal.role] || proposal.label : proposal.label }}</strong><br>Current: {{ selectionLabel('owner', proposal.role, proposal.previous) }}<br>Suggested: {{ selectionLabel('owner', proposal.role, proposal.proposed) }}<template v-if="!plain"> · {{ choiceFor('owner', proposal.role, proposal.proposed)?.accessLabel }}</template><br><span v-if="proposal.previous?.selectionSource === 'explicit'" class="text-body-small">You chose the current model. Select this change to replace it.</span></span></template>
            </v-checkbox>
          </template>
          <p v-if="!suggestedChanges.length" class="text-body-medium">No model changes are suggested.</p>
          <v-btn v-if="canEdit" variant="text" class="my-3" :disabled="saving" @click="customize">Configure AI setup</v-btn>
        </template>
        <template v-if="!proposalMode">
          <v-btn v-if="canEdit && recommendedChanges.length" variant="outlined" color="primary" size="small" min-height="36" class="mb-4" :disabled="saving || stale" @click="reviewRecommendations">Review recommendations</v-btn>
          <p v-else-if="canEdit" class="text-body-small mb-4" role="status">No recommended changes.</p>
          <AiPersonalUse v-for="providerId in personalProviders" :key="providerId" :provider-id="providerId" variant="note" class="model-routing__personal mb-4" />
          <template v-for="setup in visibleSetups" :key="setup.id">
            <h2 v-if="visibleSetups.length > 1" class="text-title-medium mb-3">{{ setup.label }}</h2>
            <template v-for="role in rolesFor(setup.id)" :key="`${setup.id}-${role.id}`">
              <h3 class="text-title-small mb-3">{{ role.label }}</h3>
              <div class="model-routing__role mb-4" :class="{ 'model-routing__role--compact': smAndDown }">
                <v-autocomplete
                  :ref="field => roleFields[`${setup.id}.${role.id}`] = field" :model-value="choiceId(draft[setup.id][role.id])" :items="items(setup.id, role.id)" item-title="label" item-value="id" :label="role.label" variant="outlined" :disabled="saving || !canEdit" :hint="roleHint(setup.id, role.id)" persistent-hint :error-messages="roleError(setup.id, role.id)"
                  :filter-keys="['title', 'raw.agent', 'raw.access', 'props.subtitle']" no-data-text="No matching models" class="model-routing__model"
                  @update:model-value="choose(setup.id, role.id, $event || '')"
                >
                  <template #subheader="{ props: group }"><v-list-subheader class="model-routing__group">{{ group.label }}</v-list-subheader></template>
                  <template #item="{ props: itemProps, item }">
                    <v-list-item v-bind="itemProps" role="option" :aria-label="[item.agent, item.label, item.props?.subtitle, item.personal ? 'Personal use' : '', item.status, item.recommended ? 'Recommended' : ''].filter(Boolean).join(' · ')" class="model-routing__option" :class="{ 'model-routing__option--model': item.engineId }" :min-height="item.engineId ? 68 : 44">
                      <template #title>
                        <div class="model-routing__option-title">
                          <span class="model-routing__model-name">{{ item.label }}</span>
                          <v-chip v-if="item.recommended" size="x-small" color="primary" variant="tonal">Recommended</v-chip>
                          <AiPersonalUse v-if="item.personal" variant="badge" />
                          <span v-if="item.status" class="text-body-small">{{ item.status }}</span>
                        </div>
                      </template>
                      <template #append="{ isSelected }"><v-icon v-if="isSelected" icon="$complete" color="primary" size="small" aria-hidden="true" /></template>
                    </v-list-item>
                  </template>
                  <template #selection="{ item }">
                    <span class="model-routing__selection">
                      <span class="model-routing__model-name">{{ item.label }}</span>
                      <span v-if="item.agent" class="text-body-small model-routing__selection-detail">{{ item.agent }}<template v-if="item.props.subtitle"> · {{ item.props.subtitle }}</template><template v-if="item.personal"> · <strong>Personal use</strong></template></span>
                    </span>
                  </template>
                </v-autocomplete>
                <v-select v-if="variants(setup.id, role.id).length" :model-value="draft[setup.id][role.id]?.variantId || ''" :items="[{ id: '', label: 'Default' }, ...variants(setup.id, role.id)]" item-title="label" item-value="id" :label="`${role.label} thinking`" variant="outlined" hide-details :disabled="saving || !canEdit" @update:model-value="changeEffort(setup.id, role.id, $event)" />
              </div>
            </template>
          </template>
        </template>
        <v-alert v-if="previewError" type="warning" variant="tonal">{{ previewError }} <v-btn variant="text" @click="retryPreview++">Retry preview</v-btn></v-alert>
      </template>
      <p v-else class="text-body-medium">Connect an AI to configure its models.</p>
    </div>
    <div class="d-flex justify-end flex-wrap ga-2 pt-4">
      <v-btn variant="text" :disabled="saving" @click="emit('close')">{{ proposalMode ? suggestedChanges.length ? 'Keep current routing' : 'Done' : 'Cancel' }}</v-btn>
      <v-btn v-if="canEdit && (proposalMode ? suggestedChanges.length : connected)" variant="flat" color="primary" :disabled="saving || stale || previewPending || Boolean(loadError) || baseRevision === null || Boolean(proposalMode && !proposals.length)" @click="save">{{ saving ? 'Saving…' : proposalMode ? `Apply ${proposals.length} ${proposals.length === 1 ? 'change' : 'changes'}` : 'Save routing' }}</v-btn>
    </div>
    <v-dialog v-if="canEdit" :model-value="Boolean(recommendationReview)" max-width="36rem" scrollable aria-label="Recommended model changes" @update:model-value="!$event && (recommendationReview = null)">
      <v-card v-if="recommendationReview" rounded="xl" title="Recommended changes">
        <v-card-text>
          <v-alert v-if="stale" type="warning" variant="tonal" class="mb-4">Routing changed. Close this review and reload current choices.</v-alert>
          <ul class="model-routing__changes pl-4">
            <li v-for="change in recommendationReview.changes" :key="`${change.setup}.${change.role}`" class="text-body-medium py-1"><strong>{{ change.label }}</strong> → {{ change.description }}</li>
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
.model-routing__proposal { margin-block: 6px; }
.model-routing__proposal :deep(.v-selection-control) { align-items: flex-start; }
.model-routing__group { font-weight: 600; color: rgb(var(--v-theme-on-surface)); background: rgba(var(--v-theme-on-surface), .04); }
.model-routing__option--model { padding-inline-start: 32px; }
.model-routing__option-title { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; white-space: normal; }
.model-routing__model-name { font-weight: 500; overflow-wrap: anywhere; }
.model-routing__option :deep(.v-list-item-subtitle) { margin-top: 4px; line-height: 1.4; opacity: .75; color: rgb(var(--v-theme-on-surface)); }
.model-routing__selection { display: flex; flex-direction: column; min-width: 0; padding-block: 2px; }
.model-routing__selection-detail { opacity: .75; }
.model-routing__personal { background: rgba(var(--v-theme-warning), .12); border-radius: 12px; padding: 10px 12px; }
.model-routing__model :deep(.v-autocomplete__selection) { max-width: 100%; }
</style>
