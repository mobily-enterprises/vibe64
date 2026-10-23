<script setup>
// Add a target: choose where it goes (with what it needs, how long it takes
// and what it costs), then which package and which account.
import { computed, ref, watch } from "vue";
import { mdiArrowLeft, mdiCheck, mdiClockOutline, mdiCurrencyUsd, mdiPlus } from "@mdi/js";
import { destinationAccent, destinationIcon } from "./publishFormat.js";

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  state: { type: Object, default: null },
  preset: { type: String, default: "" },
  call: { type: Function, required: true }
});
const emit = defineEmits(["update:modelValue", "add-account", "added"]);

const destinationId = ref("");
const packageId = ref("");
const accountId = ref("");
const channel = ref("");
const error = ref("");
const saving = ref(false);

const destinations = computed(() => (props.state?.destinations || []).map((entry) => ({
  ...entry,
  accountKind: (props.state?.accountKinds || []).find((kind) => kind.destination === entry.id) || null
})));
const chosen = computed(() => destinations.value.find((entry) => entry.id === destinationId.value) || null);
const packages = computed(() => (props.state?.packaging?.packages || []).filter((entry) => chosen.value?.packers.includes(entry.packer)));
const accounts = computed(() => (props.state?.accounts || []).filter((entry) => entry.kind === chosen.value?.accountKind?.id));
const needsAccount = computed(() => Boolean(chosen.value?.accountKind));
const canAdd = computed(() => Boolean(chosen.value && packageId.value && (!needsAccount.value || accountId.value)));
const fits = (entry) => (props.state?.packaging?.packages || []).some((candidate) => entry.packers.includes(candidate.packer));

watch(() => props.modelValue, (open) => {
  if (!open) return;
  error.value = "";
  pick(props.preset || "");
});
watch(accounts, (list) => {
  if (!list.some((entry) => entry.id === accountId.value)) accountId.value = list[0]?.id || "";
});

function pick(id) {
  destinationId.value = id;
  packageId.value = packages.value.length === 1 ? packages.value[0].id : "";
  accountId.value = accounts.value[0]?.id || "";
  channel.value = "";
}

async function add() {
  if (!canAdd.value || saving.value) return;
  saving.value = true;
  error.value = "";
  try {
    const body = { destination: destinationId.value, package: packageId.value, ...(accountId.value ? { account: accountId.value } : {}), ...(channel.value.trim() ? { channel: channel.value.trim() } : {}) };
    const answer = await props.call("/targets", { body });
    emit("added", answer.target);
    emit("update:modelValue", false);
  } catch (failure) {
    error.value = failure.message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="760" scrollable @update:model-value="emit('update:modelValue', $event)">
    <v-card class="publish-dialog" rounded="xl">
      <v-card-title class="publish-dialog__title">
        <v-btn v-if="chosen" :icon="mdiArrowLeft" aria-label="Choose another destination" size="small" variant="text" @click="pick('')" />
        {{ chosen ? `Add ${chosen.label}` : "Where should it go?" }}
      </v-card-title>
      <v-card-text>
        <div v-if="!chosen" class="publish-destinations" role="list">
          <button
            v-for="entry in destinations"
            :key="entry.id"
            :class="`publish-destination--${destinationAccent(entry.id)}`"
            :disabled="!fits(entry)"
            class="publish-destination"
            role="listitem"
            type="button"
            @click="pick(entry.id)"
          >
            <span class="publish-destination__icon"><v-icon :icon="destinationIcon(entry.id)" size="24" /></span>
            <span class="publish-destination__copy">
              <strong>{{ entry.label }} <v-chip v-if="entry.zeroAccount" class="ml-1" color="success" size="x-small" variant="tonal">No account</v-chip></strong>
              <span>{{ entry.summary }}</span>
              <span class="publish-destination__meta">
                <span><v-icon :icon="mdiClockOutline" size="14" /> {{ entry.repeat }} after setup</span>
                <span><v-icon :icon="mdiCurrencyUsd" size="14" /> {{ entry.cost }}</span>
              </span>
              <span v-if="!fits(entry)" class="publish-destination__missing">Needs a {{ entry.packers.join(" or ") }} package in Packaging.</span>
            </span>
          </button>
        </div>

        <div v-else class="publish-add-form">
          <section class="publish-add-needs" aria-label="What it needs">
            <h3>What it needs</h3>
            <ul>
              <li v-for="need in chosen.needs" :key="need"><v-icon :icon="mdiCheck" size="16" /> {{ need }}</li>
            </ul>
            <p>First time: {{ chosen.firstTime }}. Later: {{ chosen.repeat }}. {{ chosen.cost }}.</p>
          </section>
          <v-select
            v-model="packageId"
            :items="packages"
            item-title="label"
            item-value="id"
            label="Package"
            variant="outlined"
          >
            <template #item="{ props: item, item: { raw } }">
              <v-list-item v-bind="item" :subtitle="`${raw.packer}${raw.version ? ` · ${raw.version}` : ''}`" />
            </template>
          </v-select>
          <template v-if="needsAccount">
            <v-select
              v-if="accounts.length"
              v-model="accountId"
              :items="accounts"
              item-title="label"
              item-value="id"
              :label="`${chosen.accountKind.label} account`"
              variant="outlined"
            />
            <v-alert v-else class="mb-4" type="info" variant="tonal">
              Add your {{ chosen.accountKind.label }} account to your publishing keys first.
              <template #append>
                <v-btn :prepend-icon="mdiPlus" rounded="pill" size="small" variant="flat" color="primary" @click="emit('add-account', chosen.accountKind.id)">Add account</v-btn>
              </template>
            </v-alert>
          </template>
          <v-text-field
            v-if="chosen.id === 'npm'"
            v-model="channel"
            hint="Leave empty for latest. Use next or beta for previews."
            label="Tag (optional)"
            persistent-hint
            placeholder="latest"
            variant="outlined"
          />
          <v-alert v-if="error" class="mt-3" type="error" variant="tonal">{{ error }}</v-alert>
        </div>
      </v-card-text>
      <v-card-actions class="publish-dialog__actions">
        <v-spacer />
        <v-btn rounded="pill" variant="text" @click="emit('update:modelValue', false)">Cancel</v-btn>
        <v-btn v-if="chosen" :disabled="!canAdd" :loading="saving" color="primary" rounded="pill" variant="flat" @click="add">Add target</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.publish-destinations {
  display: grid;
  gap: var(--v64-space-3, 12px);
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr));
}

.publish-destination {
  --accent: rgb(var(--v-theme-primary));
  align-items: flex-start;
  background: var(--v64-surface-container-low);
  border: 1px solid var(--v64-outline-variant);
  border-radius: var(--v64-shape-lg, 16px);
  color: inherit;
  display: flex;
  gap: var(--v64-space-3, 12px);
  padding: var(--v64-space-4, 16px);
  text-align: left;
  transition: border-color 150ms ease, background 150ms ease, transform 150ms ease;
}

.publish-destination:not(:disabled):hover,
.publish-destination:focus-visible {
  background: color-mix(in srgb, var(--accent) 6%, var(--v64-surface-container-low));
  border-color: var(--accent);
  transform: translateY(-1px);
}

.publish-destination:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.publish-destination--success { --accent: rgb(var(--v-theme-success)); }
.publish-destination--error { --accent: rgb(var(--v-theme-error)); }
.publish-destination--info { --accent: rgb(var(--v-theme-info)); }

.publish-destination__icon {
  align-items: center;
  background: color-mix(in srgb, var(--accent) 14%, var(--v64-surface));
  border-radius: var(--v64-shape-md, 12px);
  color: var(--accent);
  display: inline-flex;
  flex: 0 0 auto;
  height: 44px;
  justify-content: center;
  width: 44px;
}

.publish-destination__copy {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.publish-destination__copy strong {
  font: var(--v64-type-title-md);
}

.publish-destination__copy > span,
.publish-destination__meta {
  color: var(--v64-on-surface-variant);
  font: var(--v64-type-body-md);
}

.publish-destination__meta {
  display: flex;
  flex-wrap: wrap;
  font-size: 0.8125rem;
  gap: 4px 14px;
  margin-top: 4px;
}

.publish-destination__missing {
  color: rgb(var(--v-theme-warning)) !important;
  font-size: 0.8125rem !important;
}

.publish-add-form {
  display: grid;
  gap: var(--v64-space-2, 8px);
}

.publish-add-needs {
  background: var(--v64-surface-container-low);
  border-radius: var(--v64-shape-lg, 16px);
  margin-bottom: var(--v64-space-3, 12px);
  padding: var(--v64-space-4, 16px);
}

.publish-add-needs h3 {
  font: var(--v64-type-title-md);
  margin: 0 0 8px;
}

.publish-add-needs ul {
  display: grid;
  gap: 6px;
  list-style: none;
  margin: 0 0 8px;
  padding: 0;
}

.publish-add-needs li {
  align-items: baseline;
  display: flex;
  gap: 8px;
}

.publish-add-needs li .v-icon {
  color: rgb(var(--v-theme-success));
  flex: 0 0 auto;
  transform: translateY(3px);
}

.publish-add-needs p {
  color: var(--v64-on-surface-variant);
  font: var(--v64-type-body-md);
  margin: 0;
}
</style>
