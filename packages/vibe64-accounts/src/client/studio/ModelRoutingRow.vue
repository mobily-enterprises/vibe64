<script>
import { curatedCodexProvider } from "@local/vibe64-core/shared/curatedCodexProviders";
import { VIBE64_AGENT_PROVIDERS } from "@local/vibe64-runtime/shared";
import { AI_ONBOARDING_PROVIDERS } from "../onboarding/aiOnboardingProviders.js";

const TOOL_MARKS = Object.freeze({ claude: "CC", codex: "CX", opencode: "OC" });
const PLAN_NAMES = Object.freeze({ claude_plan: "Claude", chatgpt_plan: "ChatGPT" });
const toolLabel = (engineId) => VIBE64_AGENT_PROVIDERS.find(({ id }) => id === engineId)?.label || engineId;
const routeKey = (value) => JSON.stringify([value?.engineId, value?.modelProviderId, value?.modelId]);

// Which tools can run a provider's model at all: OpenCode runs any catalogue
// provider, the curated key providers also run in Claude Code and Codex, a
// Claude plan only in Claude Code and OpenAI only in Codex.
function toolCanRun(engineId, modelProviderId, billing) {
  if (engineId === "opencode") return billing === "key";
  if (curatedCodexProvider(modelProviderId)) return true;
  return engineId === "claude" ? billing === "claude_subscription" : modelProviderId === "openai";
}

// A model's default tool: the one its onboarding card connects through when
// that tool can run it, else OpenCode; a subscription's own tool is fixed.
function defaultRunsIn(group) {
  if (group.fixedRunsIn) return group.fixedRunsIn.engineId;
  const card = AI_ONBOARDING_PROVIDERS.flatMap((item) => [item, item.free].filter(Boolean))
    .find(({ connect }) => connect.modelProviderId === group.modelProviderId);
  return card && toolCanRun(card.connect.engineId, group.modelProviderId, group.billing) ? card.connect.engineId : "opencode";
}

// "Opus 5.5 · High": a selection's model and thinking, by its catalogue labels.
function routingSelectionText(choices = [], selection) {
  if (!selection?.schema) return "";
  const choice = choices.find((item) => routeKey(item) === routeKey(selection));
  const variant = choice?.variants?.find(({ id }) => id === selection.variantId)?.label || selection.variantId;
  return [choice?.label || selection.modelId, variant].filter(Boolean).join(" · ");
}

export { defaultRunsIn, routeKey, routingSelectionText, TOOL_MARKS, toolLabel };
</script>

<script setup>
import { computed, ref } from "vue";
import { mdiChevronDown } from "@mdi/js";
import { defineVibe64AssistantSelection } from "@local/vibe64-runtime/shared";
import { assistantModeLabel, routingRunsInChoices } from "@local/vibe64-runtime/shared/assistantRouting";
import AiPersonalUse from "./AiPersonalUse.vue";

// One role of an AI setup: its model and thinking, a quiet "Same as" line for a
// following role, and an Advanced "Runs in" choice where a real choice exists.
const props = defineProps({
  role: { type: Object, required: true },
  // A selection, { follows }, null (off) or undefined (never chosen).
  value: { type: Object, default: undefined },
  // What a following value currently resolves to, as "Opus 5.5 · High".
  followedLabel: { type: String, default: "" },
  // The role a following role returns to with "Use {role}'s model".
  defaultFollows: { type: String, default: "" },
  choices: { type: Array, default: () => [] },
  recommendation: { type: Object, default: null },
  error: { type: String, default: "" },
  disabled: Boolean,
  readonly: Boolean,
  // The host can open connecting this model's provider in another tool.
  connectable: Boolean
});
const emit = defineEmits(["update", "change", "connect-provider"]);
const advanced = ref(false);
const rowId = computed(() => `routing-role-${props.role.id}`);

function choiceStatus(choice) {
  if (choice.compatibilityError) return "Compatibility pending";
  if (!choice.available) return "Unavailable";
  return ["junior", "fix"].includes(props.role.id) && choice.capabilities?.toolcall === false ? "Tools unavailable" : "";
}
// One picker entry per model and billing; its tools are the "Runs in" options.
const groups = computed(() => routingRunsInChoices(props.choices).map((group) => {
  const usable = group.choices.filter((choice) => !choiceStatus(choice));
  const first = group.choices[0];
  return { ...group, id: JSON.stringify([group.modelProviderId, group.modelId, group.billing]), usable,
    label: first.label || first.modelId, providerLabel: first.providerLabel, defaultEngineId: defaultRunsIn(group),
    personal: group.choices.some((choice) => choice.available === true && choice.ownerOnly !== false),
    status: usable.length ? "" : choiceStatus(first),
    recommended: group.choices.some((choice) => routeKey(choice) === routeKey(props.recommendation)) };
}));
const selection = computed(() => props.value?.schema ? props.value : null);
const current = computed(() => selection.value && groups.value.find((group) =>
  group.choices.some((choice) => routeKey(choice) === routeKey(selection.value))));
const currentChoice = computed(() => current.value?.choices.find((choice) => routeKey(choice) === routeKey(selection.value)));
const items = computed(() => [
  ...(selection.value && !current.value ? [{ id: "saved", label: selection.value.modelId, status: "Unavailable saved choice", props: { disabled: true } }] : []),
  ...groups.value.map((group) => ({ ...group, props: { subtitle: group.providerLabel, disabled: Boolean(group.status) } }))
]);
const pickerValue = computed(() => current.value?.id || (selection.value ? "saved" : null));
const offDefault = computed(() => current.value && selection.value.engineId !== current.value.defaultEngineId);
// Runs in: the connected tools for this model, and tools it could run in once connected there.
const runsIn = computed(() => current.value?.usable.map(({ engineId }) => engineId) || []);
const elsewhere = computed(() => !current.value || current.value.fixedRunsIn ? [] : ["claude", "codex", "opencode"]
  .filter((engineId) => !current.value.engineIds.includes(engineId) && toolCanRun(engineId, current.value.modelProviderId, current.value.billing)));
const hasAdvanced = computed(() => Boolean(current.value?.fixedRunsIn) || runsIn.value.length > 1);
const fixedLine = computed(() => {
  const fixed = current.value?.fixedRunsIn;
  return fixed ? `Runs in ${toolLabel(fixed.engineId)} — required by your ${PLAN_NAMES[fixed.reason]} plan.` : "";
});
const variants = computed(() => currentChoice.value?.variants || []);

function pick(choice, variantId = selection.value?.variantId) {
  const keep = choice.variants?.some(({ id }) => id === variantId) ? variantId : choice.variantId;
  emit("update", { ...defineVibe64AssistantSelection({ ...choice, variantId: keep }), selectionSource: "explicit" });
}
function chooseModel(id) {
  const group = groups.value.find((item) => item.id === id);
  if (!group) return;
  // Keep the current tool when the model stays the same, else the model's default tool.
  const engineId = group === current.value ? selection.value.engineId : group.defaultEngineId;
  pick(group.usable.find((choice) => choice.engineId === engineId) || group.usable[0]);
}
function chooseRunsIn(engineId) {
  const choice = current.value?.usable.find((item) => item.engineId === engineId);
  if (choice) pick(choice);
}
function chooseThinking(variantId) {
  emit("update", { ...selection.value, variantId, selectionSource: "explicit" });
}
</script>

<template>
  <div class="routing-row" :class="{ 'routing-row--follows': value?.follows }" role="group" :aria-labelledby="`${rowId}-label`">
    <div :id="`${rowId}-label`" class="routing-row__label">{{ role.label }}</div>
    <div class="routing-row__body">
      <template v-if="value?.follows">
        <p class="routing-row__same">
          <span>Same as {{ assistantModeLabel(value.follows) }} · {{ followedLabel || "Not chosen yet" }}</span>
          <v-btn
            v-if="!readonly" variant="text" color="primary" size="small" class="routing-row__change" :disabled="disabled"
            :aria-label="`Change the ${role.label} model`" @click="emit('change')"
          >
            Change
          </v-btn>
        </p>
      </template>
      <template v-else>
        <p class="routing-row__description">{{ role.description }}</p>
        <div class="routing-row__controls">
          <v-autocomplete
            :model-value="pickerValue" :items="items" item-title="label" item-value="id" :label="`${role.label} model`"
            placeholder="Choose a model" variant="outlined" density="comfortable" hide-details="auto" :readonly="readonly"
            :disabled="disabled" :error-messages="error" :filter-keys="['title', 'raw.providerLabel']" no-data-text="No matching models"
            class="routing-row__model" @update:model-value="chooseModel"
          >
            <template #item="{ props: itemProps, item }">
              <v-list-item
                v-bind="itemProps" role="option" :min-height="56" class="routing-row__option"
                :aria-label="[item.label, item.providerLabel, item.personal ? 'Personal use' : '', item.status, item.recommended ? 'Recommended' : ''].filter(Boolean).join(' · ')"
              >
                <template #title>
                  <span class="routing-row__option-title">
                    <span class="routing-row__model-name">{{ item.label }}</span>
                    <v-chip v-if="item.recommended && !item.status" size="x-small" color="primary" variant="tonal">Recommended</v-chip>
                    <AiPersonalUse v-if="item.personal" variant="badge" />
                    <span v-if="item.status" class="routing-row__status">{{ item.status }}</span>
                  </span>
                </template>
                <template #append="{ isSelected }"><v-icon v-if="isSelected" icon="$complete" color="primary" size="small" aria-hidden="true" /></template>
              </v-list-item>
            </template>
            <template #selection>
              <span class="routing-row__selection" :title="[current?.label || selection?.modelId, offDefault ? `runs in ${toolLabel(value.engineId)}` : ''].filter(Boolean).join(' · ')">
                <span class="routing-row__model-name">{{ current?.label || selection?.modelId }}</span>
                <span v-if="offDefault" class="routing-row__runs-in">
                  · <span class="routing-tool" aria-hidden="true">{{ TOOL_MARKS[value.engineId] }}</span>runs in {{ toolLabel(value.engineId) }}
                </span>
              </span>
            </template>
          </v-autocomplete>
          <v-select
            v-if="variants.length" :model-value="value?.variantId || ''" :items="[{ id: '', label: 'Default' }, ...variants]"
            item-title="label" item-value="id" label="Thinking" :aria-label="`${role.label} thinking`" variant="outlined" density="comfortable"
            hide-details :readonly="readonly" :disabled="disabled" class="routing-row__thinking" @update:model-value="chooseThinking"
          />
        </div>
        <div class="routing-row__footer">
          <v-btn
            v-if="hasAdvanced" variant="text" size="small" class="routing-row__advanced-toggle" :class="{ 'is-open': advanced }"
            :append-icon="mdiChevronDown" :aria-expanded="String(advanced)" :aria-controls="`${rowId}-advanced`" @click="advanced = !advanced"
          >
            Advanced
          </v-btn>
          <span v-if="current?.personal" class="routing-row__personal"><AiPersonalUse variant="badge" /></span>
          <v-btn
            v-if="defaultFollows && !readonly" variant="text" color="primary" size="small" class="routing-row__return" :disabled="disabled"
            @click="emit('update', { follows: defaultFollows })"
          >
            Use {{ assistantModeLabel(defaultFollows) }}'s model
          </v-btn>
        </div>
        <v-expand-transition>
          <div v-if="hasAdvanced && advanced" :id="`${rowId}-advanced`" class="routing-row__advanced">
            <p v-if="fixedLine" class="routing-row__fixed">
              <span class="routing-tool" aria-hidden="true">{{ TOOL_MARKS[current.fixedRunsIn.engineId] }}</span>{{ fixedLine }}
            </p>
            <v-radio-group
              v-else :model-value="value.engineId" :label="`${role.label} runs in`" hide-details density="compact" :readonly="readonly"
              :disabled="disabled" class="routing-row__runs-in-group" @update:model-value="chooseRunsIn"
            >
              <v-radio v-for="engineId in runsIn" :key="engineId" :value="engineId" color="primary">
                <template #label>
                  <span class="routing-row__tool">
                    <span class="routing-tool" aria-hidden="true">{{ TOOL_MARKS[engineId] }}</span>{{ toolLabel(engineId) }}
                    <v-chip v-if="engineId === current.defaultEngineId" size="x-small" color="primary" variant="tonal">Recommended</v-chip>
                  </span>
                </template>
              </v-radio>
            </v-radio-group>
            <v-btn
              v-if="connectable && elsewhere.length && !readonly" variant="text" color="primary" size="small" class="routing-row__connect"
              @click="emit('connect-provider', current.modelProviderId)"
            >
              Connect {{ current.providerLabel }} in another tool
            </v-btn>
          </div>
        </v-expand-transition>
      </template>
    </div>
  </div>
</template>

<style scoped>
.routing-row {
  border-top: 1px solid var(--v64-outline-variant);
  display: grid;
  gap: var(--v64-space-1) var(--v64-space-4);
  grid-template-columns: minmax(7.5rem, 9.5rem) minmax(0, 1fr);
  padding: var(--v64-space-3) 0;
}
.routing-row__label { font: var(--v64-type-label-lg); padding-top: 2px; }
.routing-row__body { display: grid; gap: var(--v64-space-2); min-width: 0; }
.routing-row__description, .routing-row__same { color: var(--v64-on-surface-variant); font: var(--v64-type-body-md); margin: 0; }
.routing-row__same { align-items: center; display: flex; gap: var(--v64-space-2); justify-content: space-between; }
.routing-row__same > span { min-width: 0; overflow-wrap: anywhere; }
.routing-row__change { flex: none; margin-inline-end: calc(var(--v64-space-3) * -1); }
.routing-row__controls { align-items: flex-start; display: grid; gap: var(--v64-space-2); grid-template-columns: minmax(0, 1fr) minmax(6.5rem, 8.5rem); }
.routing-row__controls:not(:has(.routing-row__thinking)) { grid-template-columns: minmax(0, 1fr); }
.routing-row__advanced-toggle { margin-inline-start: calc(var(--v64-space-3) * -1); }
.routing-row__advanced-toggle :deep(.v-btn__append) { transition: transform var(--v64-duration-short) var(--v64-ease-standard); }
.routing-row__advanced-toggle.is-open :deep(.v-btn__append) { transform: rotate(180deg); }
.routing-row__footer { align-items: center; display: flex; flex-wrap: wrap; gap: var(--v64-space-2); }
.routing-row__footer:empty { display: none; }
.routing-row__return:first-child { margin-inline-start: calc(var(--v64-space-3) * -1); }
.routing-row__option-title { align-items: center; display: flex; flex-wrap: wrap; gap: 4px 8px; white-space: normal; }
.routing-row__model-name { font-weight: 500; overflow-wrap: anywhere; }
.routing-row__status { color: var(--v64-on-surface-variant); font: 400 0.8125rem/1.125rem var(--v64-font-family); }
.routing-row__option :deep(.v-list-item-subtitle) { color: var(--v64-on-surface-variant); opacity: 1; }
/* The tool suffix is the only sign of a non-default tool: in a narrow field the
   model name shortens with an ellipsis and the suffix stays whole. */
.routing-row__selection { align-items: center; display: inline-flex; gap: 6px; min-width: 0; overflow: hidden; white-space: nowrap; }
.routing-row__selection .routing-row__model-name { min-width: 0; overflow: hidden; overflow-wrap: normal; text-overflow: ellipsis; }
.routing-row__runs-in { align-items: center; color: var(--v64-on-surface-variant); display: inline-flex; flex-shrink: 0; font: var(--v64-type-body-md); gap: 4px; }
.routing-row__advanced {
  background: var(--v64-surface-container-low);
  border: 1px solid var(--v64-outline-variant);
  border-radius: var(--v64-shape-md);
  display: grid;
  gap: var(--v64-space-1);
  padding: var(--v64-space-3) var(--v64-space-4);
}
.routing-row__fixed { align-items: center; display: flex; font: var(--v64-type-body-md); gap: var(--v64-space-2); margin: 0; }
.routing-row__runs-in-group :deep(.v-label) { font: var(--v64-type-label-lg); opacity: 1; }
.routing-row__runs-in-group :deep(.v-selection-control) { min-height: 44px; }
.routing-row__tool { align-items: center; display: inline-flex; gap: var(--v64-space-2); }
.routing-row__connect { justify-self: start; margin-inline-start: calc(var(--v64-space-3) * -1); }
.routing-tool {
  align-items: center;
  background: var(--v64-surface-container-highest);
  border-radius: 6px;
  color: var(--v64-on-surface);
  display: inline-flex;
  flex: none;
  font: 700 0.625rem/1 var(--v64-font-family);
  height: 20px;
  justify-content: center;
  letter-spacing: 0.02em;
  width: 24px;
}
@media (max-width: 599.98px) {
  .routing-row { gap: var(--v64-space-1); grid-template-columns: minmax(0, 1fr); }
  .routing-row__controls { grid-template-columns: minmax(0, 1fr); }
}
@media (prefers-reduced-motion: reduce) {
  .routing-row__advanced-toggle :deep(.v-btn__append) { transition: none; }
}
</style>
