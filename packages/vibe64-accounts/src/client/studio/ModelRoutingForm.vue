<script setup>
import { computed, ref, watch } from "vue";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { ASSISTANT_MODES, ASSISTANT_ROUTING_ROLES } from "@local/vibe64-runtime/shared/assistantRouting";
import { useModelRouting } from "../composables/useModelRouting.js";
import { ACCOUNTS_ENDPOINT } from "../lib/accountsGateApi.js";

const props = defineProps({ connectionId: { type: String, default: "" }, connectionLabel: { type: String, default: "" }, readonly: Boolean });
const emit = defineEmits(["close", "saved", "busy"]);
const { resource, engines, loadError } = useModelRouting();
const draft = ref({});
const baseRevision = ref(null);
const selectedEngine = ref("");
const proposals = ref([]);
const saving = ref(false);
const saveError = ref("");
const roleDefinitions = ASSISTANT_MODES.filter(({ id }) => ASSISTANT_ROUTING_ROLES.includes(id));
const engine = computed(() => engines.value.find(({ engineId }) => engineId === selectedEngine.value));
const stale = computed(() => baseRevision.value !== null && resource.data.value?.revision !== baseRevision.value);
const suggestedChanges = computed(() => engines.value.flatMap((item) => {
  const role = item.roles.code;
  const candidate = item.choices.find((choice) => choice.modelProviderId === props.connectionId &&
    choice.modelId === role.recommendation?.modelId);
  if (!candidate || role.assignment?.modelProviderId === props.connectionId && role.assignment.modelId === candidate.modelId) return [];
  return [{ ...item, candidate, previous: role.assignment, proposed: role.recommendation }];
}));

function hydrate(data) {
  if (!data?.ok) return;
  baseRevision.value = data.revision;
  draft.value = Object.fromEntries(data.engines.map((item) => [item.engineId,
    Object.fromEntries(ASSISTANT_ROUTING_ROLES.map((role) => [role,
      item.roles[role].assignment || (!props.connectionId ? item.roles[role].recommendation : null)]))]));
  if (!data.engines.some(({ engineId }) => engineId === selectedEngine.value)) selectedEngine.value = data.engines[0]?.engineId || "";
  proposals.value = suggestedChanges.value.filter(({ previous }) => !previous || previous.selectionSource === "recommended").map(({ engineId }) => engineId);
}
watch(() => resource.data.value, (data) => { if (baseRevision.value === null) hydrate(data); }, { immediate: true });
watch(saving, (value) => emit("busy", value));
function choiceId(selection) { return selection ? `${selection.modelProviderId}/${selection.modelId}` : ""; }
function label(item, selection) { return item.choices.find((choice) => choiceId(choice) === choiceId(selection))?.label || selection?.modelId || "Not configured"; }
function choose(role, id) {
  const choice = engine.value.choices.find((item) => choiceId(item) === id);
  draft.value[selectedEngine.value][role] = choice ? { ...choice, selectionSource: "explicit" } : null;
}
function changeEffort(role, variantId) {
  draft.value[selectedEngine.value][role] = { ...draft.value[selectedEngine.value][role], variantId, selectionSource: "explicit" };
}
const modelItems = computed(() => [
  { id: "", label: "Choose a model" }, ...(engine.value?.choices || []).map((choice) => ({
    id: choiceId(choice), label: `${choice.label} · ${choice.providerLabel}${choice.compatibilityError ? ' · Compatibility pending' : ''}`,
    props: { disabled: Boolean(choice.compatibilityError) }
  }))
]);
const compatibilityNotices = computed(() => engines.value.flatMap((item) => item.choices
  .filter((choice) => choice.compatibilityError && (props.connectionId ? choice.modelProviderId === props.connectionId : item.engineId === selectedEngine.value))
  .map((choice) => `${item.label}: ${choice.compatibilityError}`)));
function variants(role) {
  return engine.value?.choices.find((choice) => choiceId(choice) === choiceId(draft.value[selectedEngine.value]?.[role]))?.variants || [];
}
function payload() {
  const orchestrators = JSON.parse(JSON.stringify(draft.value));
  if (props.connectionId) for (const proposal of suggestedChanges.value) {
    if (proposals.value.includes(proposal.engineId)) orchestrators[proposal.engineId].code = proposal.proposed;
  }
  return { revision: baseRevision.value, orchestrators };
}
const command = useCommand({
  access: "never", apiSuffix: "/vibe64/accounts/model-routing",
  buildCommandOptions: () => ({ method: "PATCH", path: `${ACCOUNTS_ENDPOINT}/model-routing` }),
  buildRawPayload: payload,
  onRunSuccess(response) { if (response?.ok !== true) throw new Error(response?.error || "Model routing was not saved."); },
  messages: { success: "Model routing saved. New requests will use these assignments.", error: "Model routing was not saved." },
  fallbackRunError: "Model routing was not saved.", ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
  placementSource: "vibe64.accounts.model-routing", surfaceId: "app", writeMethod: "PATCH"
});
async function save() {
  if (saving.value || stale.value || props.readonly) return;
  saving.value = true;
  saveError.value = "";
  try {
    const result = await command.run();
    if (result?.ok === true) { await resource.reload(); emit("saved"); }
  } catch (error) { saveError.value = error.message || "Model routing was not saved. Your draft is retained."; }
  finally { saving.value = false; }
}
async function reload() { await resource.reload(); hydrate(resource.data.value); }
</script>

<template>
  <section class="model-routing" aria-label="Model routing">
    <div class="model-routing__body">
      <p class="text-title-large mb-2">{{ connectionId ? `${connectionLabel || connectionId} connected` : 'Model routing' }}</p>
      <p class="text-body-medium mb-4">{{ connectionId ? 'Use this connection for coding? Review the changes below.' : 'Choose the models each assistant uses for Plan, Code, and Economy.' }}</p>
      <v-skeleton-loader v-if="resource.isInitialLoading.value || baseRevision === null && !loadError" type="list-item-two-line@3, actions" />
      <v-alert v-else-if="loadError" type="error" variant="tonal">
        {{ loadError }} <v-btn variant="text" @click="reload">Retry</v-btn>
      </v-alert>
      <template v-else>
        <p v-for="notice in compatibilityNotices" :key="notice" class="text-body-small mb-3">{{ notice }}</p>
        <v-alert v-if="stale" type="warning" variant="tonal" class="mb-3">
          Routing changed in another tab. Your draft is retained.
          <v-btn variant="text" @click="reload">Reload current choices</v-btn>
        </v-alert>
        <template v-if="connectionId">
          <div v-for="proposal in suggestedChanges" :key="proposal.engineId" class="mb-3">
            <v-checkbox v-model="proposals" :value="proposal.engineId" :label="`${proposal.label}: ${label(proposal, proposal.previous)} → ${proposal.candidate.label}`" :disabled="saving || readonly" hide-details />
            <p class="text-body-small ms-4">{{ proposal.candidate.description || proposal.candidate.providerLabel }}. {{ proposal.previous?.selectionSource === 'explicit' ? 'Your custom choice is kept unless you select this change.' : 'Recommended for implementation.' }}</p>
          </div>
          <p v-if="!suggestedChanges.length" class="text-body-medium">Your current coding assignments remain preferred, or this connection has no ready coding route. You can change assignments in Model routing.</p>
          <p class="text-body-small mt-3">Plan and Economy keep their current assignments. Applying these choices does not start an assistant.</p>
        </template>
        <template v-else-if="engines.length">
          <v-select v-model="selectedEngine" :items="engines" item-title="label" item-value="engineId" label="Assistant" variant="outlined" hide-details class="mb-4" :disabled="saving" />
          <div v-for="role in roleDefinitions" :key="`${selectedEngine}-${role.id}`" class="model-routing__role mb-4">
            <v-select :model-value="choiceId(draft[selectedEngine]?.[role.id])" :items="modelItems" item-title="label" item-value="id" :label="role.label" variant="outlined" :disabled="saving || readonly" :hint="role.description" persistent-hint :error-messages="engine?.roles[role.id]?.error && choiceId(draft[selectedEngine]?.[role.id]) === choiceId(engine.roles[role.id].assignment) ? engine.roles[role.id].error : ''" @update:model-value="choose(role.id, $event)" />
            <v-select v-if="variants(role.id).length" :model-value="draft[selectedEngine]?.[role.id]?.variantId || ''" :items="[{ id: '', label: 'Default thinking' }, ...variants(role.id)]" item-title="label" item-value="id" :label="`${role.label} thinking`" variant="outlined" hide-details :disabled="saving || readonly" @update:model-value="changeEffort(role.id, $event)" />
          </div>
          <p class="text-body-small">Auto sends your message and recent chat context to Economy, then sends the request to Plan or Code. Review after coding adds a Plan-model turn that may make fixes. Accounts use their own API credit or plan allowance.</p>
          <p class="text-body-small mt-2">Background helpers for suggestions and naming keep their existing settings.</p>
        </template>
        <p v-else class="text-body-medium">Connect an assistant account to configure its modes.</p>
      </template>
    </div>
    <v-alert v-if="saveError" type="error" variant="tonal" density="compact" class="mt-2">{{ saveError }}</v-alert>
    <div class="d-flex justify-end flex-wrap ga-2 mt-4">
      <v-btn variant="text" :disabled="saving" @click="emit('close')">{{ connectionId ? 'Not now' : 'Cancel' }}</v-btn>
      <v-btn v-if="!readonly" variant="flat" color="primary" :disabled="saving || stale || Boolean(loadError) || baseRevision === null || !engines.length || Boolean(connectionId && !proposals.length)" @click="save">
        {{ saving ? 'Saving…' : connectionId ? `Apply ${proposals.length} changes` : 'Save routing' }}
      </v-btn>
    </div>
  </section>
</template>

<style scoped>
.model-routing { min-width: 0; display: flex; flex-direction: column; max-height: calc(100dvh - 96px); }
.model-routing__body { overflow-y: auto; min-height: 0; padding-top: 4px; }
.model-routing__role { display: grid; grid-template-columns: minmax(0, 1fr) minmax(120px, .4fr); gap: 12px; align-items: start; }
@media (max-width: 500px) {
  .model-routing__role { grid-template-columns: minmax(0, 1fr); }
}
</style>
