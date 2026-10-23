<script setup>
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { vibe64AssistantSelectionLabel } from "@local/vibe64-runtime/shared";
import { ASSISTANT_FOLLOWING_ROLES, ASSISTANT_ROLE_DEFAULT_FOLLOWS, ASSISTANT_ROLE_PURPOSES, ASSISTANT_ROUTING_ROLE_DEFINITIONS,
  ASSISTANT_SETUP_ROLES, assistantModeLabel, assistantSetupRoleValue } from "@local/vibe64-runtime/shared/assistantRouting";
import { useModelRouting } from "../composables/useModelRouting.js";
import { ACCOUNTS_ENDPOINT } from "../lib/accountsGateApi.js";
import AiPersonalUse from "./AiPersonalUse.vue";
import ModelRoutingRow, { routeKey, routingSelectionText } from "./ModelRoutingRow.vue";

// The AI setup's models: the owner's setup (main chat and helpers) and, for the
// owner, the team members' setup. After a connection it instead proposes the
// owner roles that move onto it.
const props = defineProps({ connectionId: { type: String, default: "" }, connectionLabel: { type: String, default: "" },
  // With connectionId: propose making that provider, in this tool, the main AI ("Use as main AI").
  preferEngineId: { type: String, default: "" },
  setupError: { type: String, default: "" }, focusRole: { type: String, default: "" }, readonly: Boolean,
  // Opens on Team members, such as from the team setup card.
  initialSetup: { type: String, default: "owner" },
  // Inside onboarding: model display names and plain role names, no heading.
  plain: Boolean,
  // Listeners as props, so "Add a DeepSeek key" and "Connect … in another tool"
  // appear only where the host can open those steps.
  onAddTeamKey: { type: Function, default: null }, onConnectProvider: { type: Function, default: null } });
const emit = defineEmits(["close", "saved", "busy"]);
const SETUPS = [{ id: "owner", label: "Owner (you)" }, { id: "nonOwner", label: "Team members" }];
const GROUPS = [{ id: "main", label: "Main chat" }, { id: "helpers", label: "Helpers" }];
const MAIN_AI_ROLES = ["senior", "junior", "router", "quickHelper"];
const customizing = ref(false);
const proposalMode = computed(() => Boolean(props.connectionId) && !customizing.value);
const { resource, engines, scopeKey, team, loadError: resourceError } = useModelRouting();
const refreshError = ref("");
const loadError = computed(() => resourceError.value || refreshError.value);
// draft[setup][role]: a selection, null (off) or { follows }; absent roles stay absent.
const draft = ref({ owner: {}, nonOwner: {} });
const baseRevision = ref(null);
const recommendationReview = ref(null);
const proposals = ref([]);
// Owner role states from a preview that prefers the connection (Use as main AI).
const preferred = ref(null);
const saving = ref(false);
const fieldErrors = ref({});
const preview = ref(null);
const previewPending = ref(false);
const previewError = ref("");
const retryPreview = ref(0);
const refreshingConnection = ref(Boolean(props.connectionId));
const activeSetup = ref(props.initialSetup === "nonOwner" ? "nonOwner" : "owner");
let savedPayload = "";
let savedValues = { owner: {}, nonOwner: {} };
let hydratedDraft = "";
const draftSnapshot = () => JSON.stringify({ draft: draft.value, proposals: proposals.value, customizing: customizing.value });
const owner = computed(() => resource.data.value?.canConfigure === true);
const canEdit = computed(() => !props.readonly && owner.value);
// Team members see their own setup, read only; the owner switches between both.
const setup = computed(() => owner.value ? activeSetup.value : "nonOwner");
const connected = computed(() => engines.value.some((engine) => engine.connected));
const ownerName = computed(() => team.value?.ownerName || "the workspace owner");
const roleState = (setupId, role, data = resource.data.value) => data?.setups?.[setupId]?.roles?.[role];
const teamConfigured = computed(() => ASSISTANT_SETUP_ROLES.nonOwner.some((role) => roleState("nonOwner", role)?.configured ||
  Object.hasOwn(draft.value.nonOwner, role) && !implicitFollows("nonOwner", role, draft.value.nonOwner[role])));
const showSwitch = computed(() => owner.value && (teamConfigured.value || props.initialSetup === "nonOwner"));
// No team model yet: no team role resolves to a model.
const teamEmpty = computed(() => !ASSISTANT_SETUP_ROLES.nonOwner.some((role) => assistantSetupRoleValue(draft.value.nonOwner, role).value?.schema));
const teamChoices = computed(() => (roleState("nonOwner", "colleague")?.choices || []).length > 0);
const rowRefs = ref({});
watch([() => resource.data.value?.setups, () => props.focusRole], async () => {
  if (!props.focusRole) return;
  await nextTick();
  const row = rowRefs.value[`${setup.value}.${props.focusRole}`]?.$el;
  row?.scrollIntoView?.({ block: "center" });
  row?.querySelector?.('input[role="combobox"]')?.focus({ preventScroll: true });
}, { immediate: true });
const stale = computed(() => baseRevision.value !== null && resource.data.value?.revision !== baseRevision.value);
const rolesFor = (setupId, group) => ASSISTANT_ROUTING_ROLE_DEFINITIONS.filter(({ id, group: roleGroup }) =>
  ASSISTANT_SETUP_ROLES[setupId].includes(id) && (!group || roleGroup === group));
const groupsFor = (setupId) => GROUPS.filter(({ id }) => rolesFor(setupId, id).length);
function sameValue(left, right) {
  if (left?.follows || right?.follows) return left?.follows === right?.follows;
  return routeKey(left) === routeKey(right) && left?.variantId === right?.variantId && left?.agentId === right?.agentId;
}
function choiceFor(setupId, role, selection) {
  return (roleState(setupId, role)?.choices || []).find((item) => routeKey(item) === routeKey(selection));
}
const followedLabel = (setupId, role) => {
  const target = draft.value[setupId][role]?.follows;
  return target ? routingSelectionText(roleState(setupId, target)?.choices, draft.value[setupId][target]) : "";
};
// An explicit following role can return to its default "Same as".
const defaultFollows = (setupId, role) => ASSISTANT_FOLLOWING_ROLES.includes(role) && !draft.value[setupId][role]?.follows
  ? ASSISTANT_ROLE_DEFAULT_FOLLOWS[setupId][role] || "" : "";
const PLAIN_ROLES = { senior: "Building", junior: "Quick tasks", quickHelper: "Background helpers", router: "Request routing" };
function selectionLabel(setupId, role, value) {
  if (value?.follows) return `Same as ${assistantModeLabel(value.follows)}`;
  if (!value) return "No model selected";
  return props.plain ? choiceFor(setupId, role, value)?.label || value.modelId : vibe64AssistantSelectionLabel(value);
}
const recommendedChanges = computed(() => rolesFor(setup.value).flatMap(({ id, label }) => {
  const proposed = roleState(setup.value, id)?.recommendation;
  if (!proposed || sameValue(draft.value[setup.value][id], proposed)) return [];
  return [{ setup: setup.value, role: id, label, proposed, description: selectionLabel(setup.value, id, proposed) }];
}));
// Onboarding proposals: owner roles whose recommendation moves onto this connection.
const suggestedChanges = computed(() => !connected.value ? [] : (preferred.value ? MAIN_AI_ROLES : ASSISTANT_SETUP_ROLES.owner).flatMap((role) => {
  const value = roleState("owner", role)?.value;
  const recommendation = (preferred.value || resource.data.value?.setups?.owner?.roles)?.[role]?.recommendation;
  if (!recommendation?.schema || recommendation.modelProviderId !== props.connectionId || sameValue(value, recommendation)) return [];
  return [{ id: `owner:${role}`, setup: "owner", role, label: assistantModeLabel(role), previous: value?.schema ? value : null, proposed: recommendation }];
}));
// An unsaved following role shows its default "Same as"; it is saved with its
// setup's first real change.
function implicitFollows(setupId, role, value) {
  return !Object.hasOwn(savedValues[setupId], role) && Boolean(value?.follows) && value.follows === ASSISTANT_ROLE_DEFAULT_FOLLOWS[setupId][role];
}
function payload() {
  const values = JSON.parse(JSON.stringify(draft.value));
  if (proposalMode.value) for (const proposal of suggestedChanges.value) {
    if (proposals.value.includes(proposal.id)) values[proposal.setup][proposal.role] = proposal.proposed;
  }
  const changes = Object.fromEntries(SETUPS.map(({ id: setupId }) => {
    const changed = Object.entries(values[setupId])
      .filter(([role, value]) => !sameValue(value, savedValues[setupId][role]) || (value === null) !== (savedValues[setupId][role] === null));
    return [setupId, changed.some(([role, value]) => !implicitFollows(setupId, role, value)) ? Object.fromEntries(changed) : {}];
  }).filter(([, roles]) => Object.keys(roles).length));
  return { revision: baseRevision.value, ...changes };
}
// A preferred preview proposes everything it moves; otherwise a deliberate choice stays unchecked.
const defaultProposals = () => suggestedChanges.value
  .filter(({ previous }) => preferred.value || !previous || previous.selectionSource === "recommended").map(({ id }) => id);
function hydrate(data) {
  if (!data?.ok) return;
  recommendationReview.value = null;
  baseRevision.value = data.revision;
  draft.value = Object.fromEntries(SETUPS.map(({ id: setupId }) => [setupId, Object.fromEntries(ASSISTANT_SETUP_ROLES[setupId]
    .filter((role) => roleState(setupId, role, data)?.configured).map((role) => [role, roleState(setupId, role, data).value]))]));
  fieldErrors.value = {};
  savedValues = JSON.parse(JSON.stringify(draft.value));
  for (const { id: setupId } of SETUPS) for (const [role, follows] of Object.entries(ASSISTANT_ROLE_DEFAULT_FOLLOWS[setupId])) {
    if (!Object.hasOwn(draft.value[setupId], role)) draft.value[setupId][role] = { follows };
  }
  savedPayload = JSON.stringify({ revision: data.revision });
  proposals.value = defaultProposals();
  preview.value = data;
  hydratedDraft = draftSnapshot();
}
watch(scopeKey, () => {
  baseRevision.value = null;
  draft.value = { owner: {}, nonOwner: {} };
  savedValues = { owner: {}, nonOwner: {} };
  proposals.value = [];
  preferred.value = null;
  preview.value = null;
  fieldErrors.value = {};
  customizing.value = false;
  recommendationReview.value = null;
}, { flush: "sync" });
watch(() => resource.data.value, (data) => {
  if (!refreshingConnection.value && !saving.value && (baseRevision.value === null || draftSnapshot() === hydratedDraft)) hydrate(data);
}, { immediate: true });
async function routingPreview(body, signal) {
  const result = await getHttpWebClient().request(`${ACCOUNTS_ENDPOINT}/model-routing/preview`, { method: "POST", body, signal });
  if (result?.ok !== true) throw new Error(result?.error || "Routing preview could not be loaded.");
  return result;
}
onMounted(async () => {
  if (!refreshingConnection.value) return;
  await reload();
  if (props.preferEngineId && baseRevision.value !== null && !loadError.value) {
    try {
      preferred.value = (await routingPreview({ revision: baseRevision.value,
        preferProvider: { setup: "owner", modelProviderId: props.connectionId, engineId: props.preferEngineId } })).setups.owner.roles;
      proposals.value = defaultProposals();
      hydratedDraft = draftSnapshot();
    } catch (error) { refreshError.value = error.message; }
  }
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
      const result = await routingPreview(JSON.parse(serialized), controller.signal);
      if (current) preview.value = result;
    } catch (error) { if (current) previewError.value = error.message; }
    finally { if (current) previewPending.value = false; }
  }, 250);
  cleanup(() => { current = false; clearTimeout(timer); controller.abort(); });
}, { immediate: true });
// Each personal provider the owner draft routes to, explained once above the roles.
const personalProviders = computed(() => [...new Set(ASSISTANT_SETUP_ROLES.owner.flatMap((role) => {
  const choice = choiceFor("owner", role, draft.value.owner[role]);
  return choice?.available === true && choice.ownerOnly !== false ? [choice.modelProviderId] : [];
}))]);
function update(setupId, role, value) {
  draft.value[setupId][role] = value;
  delete fieldErrors.value[`${setupId}.${role}`];
}
// Change on a "Same as" row: its pickers open on the followed model, and saving makes it a choice of its own.
function changeFollowing(setupId, role) {
  const target = draft.value[setupId][draft.value[setupId][role].follows];
  update(setupId, role, target?.schema ? { ...target, selectionSource: "explicit" } : null);
}
function roleError(setupId, role) {
  if (fieldErrors.value[`${setupId}.${role}`]) return fieldErrors.value[`${setupId}.${role}`];
  if (previewPending.value || stale.value) return "";
  const state = preview.value?.setups?.[setupId]?.roles?.[role];
  if (sameValue(state?.value, draft.value[setupId][role]) && state?.error) return state.error;
  const decision = preview.value?.setups?.[setupId]?.preview?.[ASSISTANT_ROLE_PURPOSES[role]];
  return draft.value[setupId][role]?.schema && decision && !decision.available ? decision.message || "Unavailable" : "";
}
function reviewRecommendations() {
  if (!canEdit.value || saving.value || stale.value || !recommendedChanges.value.length) return;
  recommendationReview.value = { changes: recommendedChanges.value };
}
function useRecommendations() {
  if (!recommendationReview.value || !canEdit.value || saving.value || stale.value) return;
  for (const { setup: setupId, role, proposed } of recommendationReview.value.changes) update(setupId, role, proposed);
  recommendationReview.value = null;
}
function customize() {
  const changes = payload();
  for (const { id: setupId } of SETUPS) if (changes[setupId]) Object.assign(draft.value[setupId], changes[setupId]);
  customizing.value = true;
}
const command = useCommand({
  access: "never", apiSuffix: "/vibe64/accounts/model-routing",
  buildCommandOptions: () => ({ method: "PATCH", path: `${ACCOUNTS_ENDPOINT}/model-routing` }), buildRawPayload: payload,
  onRunSuccess(response) {
    fieldErrors.value = response?.fieldErrors || {};
    if (response?.ok !== true) throw new Error(response?.error || "Models were not saved.");
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
  catch (error) { refreshError.value = error.message || "Models could not be loaded."; }
}
</script>

<template>
  <section class="model-routing" aria-label="Models">
    <div class="model-routing__body">
      <template v-if="!plain">
        <h2 class="model-routing__title">{{ proposalMode ? `${connectionLabel || connectionId} connected` : "Models" }}</h2>
        <p v-if="proposalMode" class="text-body-medium mb-4">Your connection is ready. Model changes are optional.</p>
      </template>
      <v-alert v-if="setupError" type="warning" variant="tonal" class="mb-4">Your AI is connected, but its model defaults could not be saved. {{ setupError }} Review the choices below to finish setup.</v-alert>
      <v-skeleton-loader v-if="resource.isInitialLoading.value || baseRevision === null && !loadError" type="list-item-two-line@5, actions" />
      <v-alert v-else-if="loadError" type="error" variant="tonal">{{ loadError }} <v-btn variant="text" @click="reload">Retry</v-btn></v-alert>
      <template v-else-if="connected">
        <v-alert v-if="stale" type="warning" variant="tonal" class="mb-4">Models changed in another tab. Your draft is retained. <v-btn variant="text" @click="reload">Reload current choices</v-btn></v-alert>
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
        <template v-else>
          <v-btn-toggle
            v-if="showSwitch" v-model="activeSetup" mandatory divided variant="outlined" color="primary" density="comfortable"
            class="model-routing__switch" aria-label="Which setup"
          >
            <v-btn v-for="item in SETUPS" :key="item.id" :value="item.id" :disabled="saving">{{ item.label }}</v-btn>
          </v-btn-toggle>
          <div v-if="setup === 'nonOwner'" class="model-routing__intro">
            <template v-if="owner">
              <p>Team members' Colleague, Fix it with AI, Explain &amp; check and Quick helper use these models. Main chat always runs on your setup, and you approve what team members send to it.</p>
              <p>Personal plans, like your Claude plan, can't be used by team members.</p>
            </template>
            <template v-else>
              <p>{{ ownerName[0].toUpperCase() + ownerName.slice(1) }} chose these models for team members. Main chat runs on {{ ownerName }}'s setup.</p>
              <p>Change your own Colleague's model from Colleague's menu.</p>
            </template>
          </div>
          <div v-if="setup === 'nonOwner' && teamEmpty" class="model-routing__empty" role="status">
            <p>No team AI yet. {{ owner ? "Team members can't open projects until you add one." : `Ask ${ownerName} to set up AI for team members.` }}</p>
            <p v-if="canEdit && teamChoices">Or choose a Workspace-use model you already connected below.</p>
            <v-btn v-if="canEdit && onAddTeamKey" color="primary" variant="flat" :disabled="saving" @click="onAddTeamKey()">Add a DeepSeek key</v-btn>
          </div>
          <template v-if="setup === 'owner' || teamChoices || !teamEmpty">
            <div v-if="canEdit && !(setup === 'nonOwner' && teamEmpty)" class="model-routing__tools">
              <v-btn v-if="recommendedChanges.length" variant="outlined" color="primary" size="small" min-height="36" :disabled="saving || stale" @click="reviewRecommendations">Review recommendations</v-btn>
              <p v-else class="text-body-small" role="status">No recommended changes.</p>
            </div>
            <template v-if="setup === 'owner'">
              <AiPersonalUse v-for="providerId in personalProviders" :key="providerId" :provider-id="providerId" variant="note" class="model-routing__personal mb-4" />
            </template>
            <section v-for="group in groupsFor(setup)" :key="`${setup}-${group.id}`" class="model-routing__group" :aria-labelledby="`routing-group-${setup}-${group.id}`">
              <h3 :id="`routing-group-${setup}-${group.id}`" class="model-routing__group-title">{{ group.label }}</h3>
              <ModelRoutingRow
                v-for="role in rolesFor(setup, group.id)" :key="`${setup}-${role.id}`" :ref="row => rowRefs[`${setup}.${role.id}`] = row"
                :role="role" :value="draft[setup][role.id]" :followed-label="followedLabel(setup, role.id)"
                :default-follows="defaultFollows(setup, role.id)" :choices="roleState(setup, role.id)?.choices || []"
                :recommendation="roleState(setup, role.id)?.recommendation" :error="roleError(setup, role.id)"
                :disabled="saving" :readonly="!canEdit"
                @update="update(setup, role.id, $event)" @change="changeFollowing(setup, role.id)"
                :connectable="Boolean(onConnectProvider)" @connect-provider="onConnectProvider($event)"
              />
            </section>
          </template>
        </template>
        <v-alert v-if="previewError" type="warning" variant="tonal" class="mt-3">{{ previewError }} <v-btn variant="text" @click="retryPreview++">Retry preview</v-btn></v-alert>
      </template>
      <p v-else class="text-body-medium">Connect an AI to choose its models.</p>
    </div>
    <div class="model-routing__actions">
      <span v-if="previewPending && !proposalMode" class="model-routing__checking" role="status">Checking access…</span>
      <v-btn variant="text" :disabled="saving" @click="emit('close')">{{ proposalMode ? suggestedChanges.length ? 'Keep current models' : 'Done' : canEdit ? 'Cancel' : 'Close' }}</v-btn>
      <v-btn v-if="canEdit && (proposalMode ? suggestedChanges.length : connected)" variant="flat" color="primary" :disabled="saving || stale || previewPending || Boolean(loadError) || baseRevision === null || Boolean(proposalMode && !proposals.length)" @click="save">{{ saving ? 'Saving…' : proposalMode ? `Apply ${proposals.length} ${proposals.length === 1 ? 'change' : 'changes'}` : 'Save' }}</v-btn>
    </div>
    <v-dialog v-if="canEdit" :model-value="Boolean(recommendationReview)" max-width="36rem" scrollable aria-label="Recommended model changes" @update:model-value="!$event && (recommendationReview = null)">
      <v-card v-if="recommendationReview" rounded="xl" title="Recommended changes">
        <v-card-text>
          <v-alert v-if="stale" type="warning" variant="tonal" class="mb-4">Models changed. Close this review and reload current choices.</v-alert>
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
.model-routing__title { font: var(--v64-type-title-lg); margin: 0 0 var(--v64-space-3); }
.model-routing__switch { margin-bottom: var(--v64-space-4); max-width: 100%; }
.model-routing__switch .v-btn { letter-spacing: 0; text-transform: none; }
.model-routing__intro { color: var(--v64-on-surface-variant); font: var(--v64-type-body-md); margin-bottom: var(--v64-space-4); }
.model-routing__intro p { margin: 0 0 var(--v64-space-2); max-width: 62ch; }
.model-routing__empty {
  align-items: center;
  background: var(--v64-surface-container-low);
  border: 1px dashed var(--v64-outline);
  border-radius: var(--v64-shape-md);
  display: flex;
  flex-wrap: wrap;
  gap: var(--v64-space-3);
  justify-content: space-between;
  margin-bottom: var(--v64-space-4);
  padding: var(--v64-space-4);
}
.model-routing__empty p { font: var(--v64-type-body-md); margin: 0; max-width: 40ch; }
.model-routing__tools { align-items: center; display: flex; margin-bottom: var(--v64-space-3); min-height: 36px; }
.model-routing__tools p { color: var(--v64-on-surface-variant); margin: 0; }
.model-routing__group + .model-routing__group { margin-top: var(--v64-space-4); }
.model-routing__group-title {
  color: var(--v64-on-surface-variant);
  font: var(--v64-type-label-md);
  letter-spacing: 0.08em;
  margin: 0 0 var(--v64-space-1);
  text-transform: uppercase;
}
.model-routing__actions { align-items: center; display: flex; flex-wrap: wrap; gap: var(--v64-space-2); justify-content: flex-end; padding-top: var(--v64-space-4); }
.model-routing__checking { color: var(--v64-on-surface-variant); font: 400 0.8125rem/1.125rem var(--v64-font-family); margin-inline-end: auto; }
.model-routing__changes { overflow-wrap: anywhere; }
.model-routing__proposal { margin-block: 6px; }
.model-routing__proposal :deep(.v-selection-control) { align-items: flex-start; }
.model-routing__personal { background: rgba(var(--v-theme-warning), .12); border-radius: 12px; padding: 10px 12px; }
@media (max-width: 599.98px) {
  .model-routing__switch { display: flex; width: 100%; }
  .model-routing__switch .v-btn { flex: 1 1 0; min-height: 48px; }
  .model-routing__empty .v-btn { width: 100%; }
}
</style>
