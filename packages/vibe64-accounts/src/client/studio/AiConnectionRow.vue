<script setup>
import { computed } from "vue";
import {
  mdiAlertCircleOutline, mdiCheck, mdiCreditCardOutline, mdiRefresh, mdiShieldCheckOutline, mdiStopCircleOutline
} from "@mdi/js";
import { injectAiConnectionManager } from "../composables/useAiConnectionManager.js";

// One configured connection: who it is, whether it works, and what can be done
// with it. Its parts come from AI Accounts' rows; actions go through the
// screen's connection manager.
const props = defineProps({
  account: { type: Object, required: true },
  // "engine" leads with the orchestrator (inside a provider's Manage),
  // "provider" with the provider (in lists by orchestrator), "pair" with the
  // provider and the tool it runs through.
  lead: { type: String, default: "engine" },
  // Model access settings; lists that repeat a connection shown elsewhere leave them out.
  details: { type: Boolean, default: true }
});

const ENGINES = { claude: "Claude Code", codex: "Codex", opencode: "OpenCode" };
const {
  applyZenModelAccess, connectedWorkflows, manageConfiguredAi, requestModelAccess, requestRemove, routingEngineId,
  routingOpen, updatingModelAccessProviderId, zenAccessTitle, zenCheck, zenCheckIsRunning, zenCheckProgress, zenCheckSummary
} = injectAiConnectionManager();

const working = computed(() => props.account.kind === "opencode" ? props.account.connected !== false : props.account.connected === true);
const engine = computed(() => ENGINES[props.account.engineId] || props.account.engineId);
const title = computed(() => props.lead === "engine" ? engine.value : props.account.providerLabel);
const via = computed(() => props.lead === "pair" ? `through ${engine.value}`
  : props.lead === "engine" && props.account.kind === "opencode" ? props.account.providerLabel : "");
// Native rows name the signed-in account; key rows their billing.
const detail = computed(() => props.account.billingLabel);
const status = computed(() => {
  if (!working.value) return "Reconnect required";
  if (props.account.id === "zai") return "Free model ready for new sessions";
  return props.account.modelLabel;
});
const keyHint = computed(() => working.value && props.account.kind === "opencode" ? props.account.keyHint : "");
const native = computed(() => ["claude", "codex"].includes(props.account.kind));
const changeLabel = computed(() => !working.value ? "Reconnect" : native.value ? "Manage sign-in" : "Replace key");
const routable = computed(() => working.value && (connectedWorkflows.value || []).some(({ engineId }) => engineId === props.account.engineId));

function openRouting() {
  routingEngineId.value = props.account.engineId;
  routingOpen.value = true;
}
</script>

<template>
  <article class="ai-row" :class="{ 'ai-row--attention': !working }" :aria-label="`${title}: ${working ? 'connected' : 'reconnect required'}`">
    <div class="ai-row__main">
      <span class="ai-row__status" :class="working ? 'ai-row__status--ok' : 'ai-row__status--warn'" aria-hidden="true">
        <v-icon :icon="working ? mdiCheck : mdiAlertCircleOutline" size="20" />
      </span>
      <div class="ai-row__identity">
        <span class="ai-row__title">
          <strong>{{ title }}</strong>
          <span v-if="via" class="ai-row__via">{{ via }}</span>
        </span>
        <span v-if="detail" class="ai-row__detail">{{ detail }}</span>
        <span class="ai-row__meta" :class="{ 'ai-row__meta--warn': !working }">
          {{ status }}<template v-if="keyHint"> · <span class="ai-row__key">{{ keyHint }}</span></template>
        </span>
      </div>
      <div class="ai-row__chips">
        <slot name="connection-access" :connection="account" place="row" />
        <span v-if="account.preferred" class="ai-row__chip">Default</span>
      </div>
    </div>

    <div v-if="details && account.id === 'opencode' && account.modelAccess" class="ai-row__panel" aria-live="polite">
      <div class="ai-row__panel-copy">
        <v-icon :icon="zenCheckIsRunning(account) ? mdiRefresh : mdiShieldCheckOutline" size="20" class="ai-row__panel-icon" />
        <span>
          <strong>{{ zenAccessTitle(account) }}</strong>
          <small>
            The recommended Zen model always remains available. Checking sends one tiny, potentially billable request to each current Zen model, one at a time.
          </small>
        </span>
      </div>
      <div v-if="zenCheck(account).status" class="ai-row__progress">
        <v-progress-linear
          v-if="zenCheckIsRunning(account)" color="primary" :indeterminate="!zenCheck(account).total"
          :model-value="zenCheckProgress(account)" rounded
        />
        <small>{{ zenCheckSummary(account) }}</small>
      </div>
      <div class="ai-row__panel-actions">
        <v-btn
          color="primary" :disabled="Boolean(updatingModelAccessProviderId) || zenCheckIsRunning(account)" variant="tonal"
          @click="applyZenModelAccess(account, 'check-available')"
        >
          Check &amp; enable working models
        </v-btn>
        <v-btn
          :disabled="Boolean(updatingModelAccessProviderId) || zenCheckIsRunning(account)" variant="text"
          @click="applyZenModelAccess(account, 'enable-all')"
        >
          Enable all current models
        </v-btn>
        <v-btn
          :disabled="Boolean(updatingModelAccessProviderId) || zenCheckIsRunning(account)" variant="text"
          @click="applyZenModelAccess(account, 'disable-additional')"
        >
          Use the recommended model only
        </v-btn>
        <v-btn
          v-if="zenCheckIsRunning(account)" color="error" :prepend-icon="mdiStopCircleOutline" variant="text"
          :disabled="updatingModelAccessProviderId === account.id || zenCheck(account).status === 'cancelling'"
          @click="applyZenModelAccess(account, 'cancel-check')"
        >
          {{ zenCheck(account).status === 'cancelling' ? "Stopping…" : "Cancel check" }}
        </v-btn>
      </div>
    </div>

    <div
      v-if="details && account.id !== 'opencode' && account.modelAccess?.configurable" class="ai-row__panel ai-row__panel--switch"
      :class="{ 'ai-row__panel--paid': account.modelAccess.mode === 'all' }"
    >
      <div class="ai-row__panel-copy">
        <v-icon
          :icon="account.modelAccess.mode === 'all' ? mdiCreditCardOutline : mdiShieldCheckOutline" size="20"
          class="ai-row__panel-icon"
        />
        <span>
          <strong>{{ account.modelAccess.mode === 'all' ? "All Z.AI models unlocked" : "Free-only model access" }}</strong>
          <small>
            {{ account.modelAccess.mode === 'all'
              ? "GLM-4.7 Flash remains free; other model choices can consume Z.AI API credit."
              : "GLM-4.7 Flash stays available. Paid Z.AI models remain visible but locked." }}
          </small>
        </span>
      </div>
      <v-switch
        color="primary" :disabled="Boolean(updatingModelAccessProviderId)" hide-details inset density="compact"
        :aria-label="account.modelAccess.label"
        :label="updatingModelAccessProviderId === account.id
          ? (account.modelAccess.mode === 'all' ? 'Returning to free only…' : 'Unlocking paid models…')
          : account.modelAccess.label"
        :model-value="account.modelAccess.mode === 'all'"
        @click.prevent="requestModelAccess(account, account.modelAccess.mode !== 'all')"
      />
    </div>

    <div class="ai-row__actions">
      <v-btn :color="working ? undefined : 'warning'" :variant="working ? 'tonal' : 'flat'" @click="manageConfiguredAi(account)">
        {{ changeLabel }}
      </v-btn>
      <v-btn v-if="routable" variant="text" @click="openRouting">Model routing</v-btn>
      <v-btn v-if="account.removable !== false" class="ai-row__remove" color="error" variant="text" @click="requestRemove(account)">
        Remove
      </v-btn>
    </div>
  </article>
</template>

<style scoped>
.ai-row {
  --ai-row-on-success: color-mix(in srgb, var(--v64-success) 55%, #000);
  --ai-row-type-title-sm: 500 0.9375rem/1.375rem var(--v64-font-family);
  --ai-row-type-body-sm: 400 0.8125rem/1.125rem var(--v64-font-family);
  background: var(--v64-surface);
  border: 1px solid var(--v64-outline-variant);
  border-radius: var(--v64-shape-lg);
  display: grid;
  gap: var(--v64-space-3);
  min-width: 0;
  padding: var(--v64-space-4);
}
.v-theme--dark .ai-row { --ai-row-on-success: color-mix(in srgb, var(--v64-success) 45%, #fff); }
.ai-row--attention {
  background: color-mix(in srgb, rgb(var(--v-theme-warning)) 6%, var(--v64-surface));
  border-color: color-mix(in srgb, rgb(var(--v-theme-warning)) 45%, var(--v64-outline-variant));
}
.ai-row :deep(.v-btn:not(.v-btn--icon)) { border-radius: var(--v64-shape-md); letter-spacing: 0; text-transform: none; }
.ai-row__main { align-items: flex-start; display: grid; gap: var(--v64-space-3); grid-template-columns: auto minmax(0, 1fr) auto; }
.ai-row__status {
  align-items: center;
  border-radius: var(--v64-shape-full);
  display: inline-flex;
  height: 36px;
  justify-content: center;
  width: 36px;
}
.ai-row__status--ok { background: var(--v64-success-container); color: var(--ai-row-on-success); }
.ai-row__status--warn { background: color-mix(in srgb, rgb(var(--v-theme-warning)) 22%, var(--v64-surface)); color: rgb(var(--v-theme-warning)); }
.ai-row__identity { display: grid; gap: 2px; min-width: 0; }
.ai-row__title { align-items: baseline; display: flex; flex-wrap: wrap; gap: 0 var(--v64-space-2); }
.ai-row__title strong { font: var(--v64-type-title-md); }
.ai-row__via { color: var(--v64-on-surface-variant); font: var(--v64-type-body-md); }
.ai-row__detail { font: var(--v64-type-body-md); overflow-wrap: anywhere; }
.ai-row__meta { color: var(--v64-on-surface-variant); font: var(--v64-type-body-md); overflow-wrap: anywhere; }
.ai-row__meta--warn { color: color-mix(in srgb, rgb(var(--v-theme-warning)) 75%, var(--v64-on-surface)); font-weight: 500; }
.ai-row__key { font-variant-numeric: tabular-nums; letter-spacing: 0.04em; }
.ai-row__chips { align-items: center; display: flex; flex-wrap: wrap; gap: var(--v64-space-1); justify-content: flex-end; }
.ai-row__chip {
  background: var(--v64-success-container);
  border-radius: var(--v64-shape-full);
  color: var(--ai-row-on-success);
  font: var(--v64-type-label-md);
  padding: 2px 10px;
}
.ai-row__chips:empty { display: none; }

/* A connection's own setting, inside its tile. */
.ai-row__panel {
  background: var(--v64-surface-container-low);
  border-radius: var(--v64-shape-md);
  display: grid;
  gap: var(--v64-space-3);
  margin-inline-start: calc(36px + var(--v64-space-3));
  padding: var(--v64-space-3) var(--v64-space-4);
}
.ai-row__panel--switch { align-items: center; grid-template-columns: minmax(0, 1fr) auto; }
.ai-row__panel--paid { background: color-mix(in srgb, rgb(var(--v-theme-warning)) 10%, var(--v64-surface)); }
.ai-row__panel-copy { align-items: flex-start; display: flex; gap: var(--v64-space-3); min-width: 0; }
.ai-row__panel-copy > span { display: grid; gap: 2px; min-width: 0; }
.ai-row__panel-copy strong { font: var(--ai-row-type-title-sm); }
.ai-row__panel-copy small, .ai-row__progress small { color: var(--v64-on-surface-variant); font: var(--ai-row-type-body-sm); }
.ai-row__panel-icon { color: var(--v64-primary); flex: none; margin-top: 1px; }
.ai-row__panel--paid .ai-row__panel-icon { color: rgb(var(--v-theme-warning)); }
.ai-row__panel .v-switch { flex: none; }
.ai-row__progress { display: grid; gap: var(--v64-space-1); }
.ai-row__panel-actions { display: flex; flex-wrap: wrap; gap: var(--v64-space-1); margin-inline-start: calc(var(--v64-space-2) * -1); }
.ai-row__panel-actions .v-btn:first-child { margin-inline-start: var(--v64-space-2); }

.ai-row__actions { align-items: center; display: flex; flex-wrap: wrap; gap: var(--v64-space-1); padding-inline-start: calc(36px + var(--v64-space-3)); }
.ai-row__remove { margin-inline-start: auto; }

@media (max-width: 599.98px) {
  .ai-row { padding: var(--v64-space-3) var(--v64-space-3) var(--v64-space-3); }
  .ai-row__main { grid-template-columns: auto minmax(0, 1fr); }
  .ai-row__chips { grid-column: 2; justify-content: flex-start; }
  .ai-row__panel, .ai-row__actions { margin-inline-start: 0; padding-inline-start: 0; }
  .ai-row__panel--switch { grid-template-columns: minmax(0, 1fr); }
  .ai-row__panel-actions { margin-inline-start: 0; }
  .ai-row__panel-actions .v-btn { flex: 1 1 100%; margin: 0; }
  .ai-row__actions .v-btn { flex: 1 1 auto; }
  .ai-row__remove { margin-inline-start: 0; }
}
</style>
