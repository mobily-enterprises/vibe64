<script setup>
import { computed, ref } from "vue";
import { mdiChevronDown, mdiPlus, mdiRefresh, mdiTune } from "@mdi/js";
import AiConnectionRow from "./AiConnectionRow.vue";
import { injectAiConnectionManager } from "../composables/useAiConnectionManager.js";

// The plumbing under the cards, collapsed: every connection by tool,
// connections no card shows (such as OpenCode Zen), exact tool and provider
// pairs, and Refresh. Models are chosen in the setup's Models screen.
const props = defineProps({
  // Configured connections that no card shows.
  otherRows: { type: Array, default: () => [] }
});
const {
  accountsInitialLoading, addAiOpen, busy, canAddConnection, configuredAiGroups, configuredAiRows,
  loadError, nativeLoadError, refreshAllAccounts, refreshingAll
} = injectAiConnectionManager();
const open = ref(false);
const summary = computed(() => {
  const count = configuredAiRows.value.length;
  const parts = [count ? `${count} ${count === 1 ? "connection" : "connections"}` : "Exact connections and refresh"];
  if (props.otherRows.length) parts.push(`${props.otherRows.length} not on a card above`);
  return parts.join(" · ");
});
</script>

<template>
  <section class="ai-advanced" :class="{ 'ai-advanced--open': open }" aria-labelledby="ai-advanced-title">
    <button
      type="button" class="ai-advanced__toggle" :aria-expanded="String(open)" aria-controls="ai-advanced-body"
      @click="open = !open"
    >
      <span class="ai-advanced__icon" aria-hidden="true"><v-icon :icon="mdiTune" size="20" /></span>
      <span class="ai-advanced__heading">
        <span id="ai-advanced-title" class="ai-advanced__title">Advanced</span>
        <span class="ai-advanced__summary">{{ summary }}</span>
      </span>
      <v-icon :icon="mdiChevronDown" class="ai-advanced__chevron" aria-hidden="true" />
    </button>

    <v-expand-transition>
      <div v-show="open" id="ai-advanced-body" class="ai-advanced__body">
        <div class="ai-advanced__actions">
          <v-btn
            color="primary" variant="tonal" :prepend-icon="mdiPlus"
            :disabled="busy || accountsInitialLoading || Boolean(loadError) || Boolean(nativeLoadError) || !canAddConnection"
            @click="addAiOpen = true"
          >
            Add a connection
          </v-btn>
          <v-btn
            variant="text" :prepend-icon="mdiRefresh" :loading="refreshingAll" :disabled="accountsInitialLoading || refreshingAll"
            aria-label="Refresh AI accounts" @click="refreshAllAccounts"
          >
            Refresh
          </v-btn>
        </div>

        <div v-if="accountsInitialLoading" aria-busy="true" aria-label="Loading AI accounts" class="ai-advanced__loading">
          <v-skeleton-loader v-for="index in 2" :key="index" type="list-item-avatar-two-line" />
        </div>
        <v-alert v-else-if="loadError" title="AI accounts could not load" type="error" variant="tonal" class="ai-advanced__error">
          <p>{{ loadError }}</p>
          <v-btn variant="tonal" color="error" :prepend-icon="mdiRefresh" @click="refreshAllAccounts">Try again</v-btn>
        </v-alert>
        <template v-else>
          <v-alert v-if="nativeLoadError" :text="nativeLoadError" title="AI account status could not load" type="warning" variant="tonal" />


          <section v-if="otherRows.length" class="ai-advanced__group" aria-labelledby="ai-advanced-other">
            <h3 id="ai-advanced-other" class="ai-advanced__group-title">Other connections</h3>
            <p class="ai-advanced__group-note">Connected providers that have no card above.</p>
            <AiConnectionRow v-for="row in otherRows" :key="`${row.kind}:${row.engineId}:${row.id}`" :account="row" lead="pair">
              <template #connection-access="scope"><slot name="connection-access" v-bind="scope" /></template>
            </AiConnectionRow>
          </section>

          <section v-for="group in configuredAiGroups" :key="group.id" class="ai-advanced__group" :aria-label="`${group.label} connections`">
            <h3 class="ai-advanced__group-title">By tool · {{ group.label }}</h3>
            <AiConnectionRow
              v-for="row in group.accounts" :key="`${row.kind}:${row.id}`" :account="row" lead="provider" :details="false"
            >
              <template #connection-access="scope"><slot name="connection-access" v-bind="scope" /></template>
            </AiConnectionRow>
          </section>
        </template>
      </div>
    </v-expand-transition>
  </section>
</template>

<style scoped>
.ai-advanced {
  background: var(--v64-surface);
  border: 1px solid var(--v64-outline-variant);
  border-radius: var(--v64-shape-xl);
  margin-top: var(--v64-space-6);
  overflow: hidden;
}
.ai-advanced :deep(.v-btn:not(.v-btn--icon)) { border-radius: var(--v64-shape-md); letter-spacing: 0; text-transform: none; }
.ai-advanced__toggle {
  align-items: center;
  background: none;
  border: 0;
  color: inherit;
  cursor: pointer;
  display: flex;
  font: inherit;
  gap: var(--v64-space-4);
  padding: var(--v64-space-4) var(--v64-space-5);
  text-align: start;
  transition: background-color var(--v64-duration-short) var(--v64-ease-standard);
  width: 100%;
}
.ai-advanced__toggle:hover { background: color-mix(in srgb, var(--v64-on-surface) 4%, transparent); }
.ai-advanced__toggle:focus-visible {
  outline: var(--v64-focus-ring-width) solid var(--v64-focus-ring-color);
  outline-offset: calc(var(--v64-focus-ring-width) * -1);
}
.ai-advanced__icon {
  align-items: center;
  background: var(--v64-surface-container-high);
  border-radius: var(--v64-shape-md);
  color: var(--v64-on-surface-variant);
  display: inline-flex;
  flex: none;
  height: 40px;
  justify-content: center;
  width: 40px;
}
.ai-advanced__heading { display: grid; flex: 1; gap: 2px; min-width: 0; }
.ai-advanced__title { font: var(--v64-type-title-md); }
.ai-advanced__summary { color: var(--v64-on-surface-variant); font: var(--v64-type-body-md); }
.ai-advanced__chevron { color: var(--v64-on-surface-variant); transition: transform var(--v64-duration-medium) var(--v64-ease-standard); }
.ai-advanced--open .ai-advanced__chevron { transform: rotate(180deg); }

.ai-advanced__body {
  border-top: 1px solid var(--v64-outline-variant);
  display: grid;
  gap: var(--v64-space-6);
  padding: var(--v64-space-5);
}
.ai-advanced__actions { align-items: center; display: flex; flex-wrap: wrap; gap: var(--v64-space-2); }
.ai-advanced__loading { display: grid; gap: var(--v64-space-2); }
.ai-advanced__group { display: grid; gap: var(--v64-space-3); }
.ai-advanced__group-title {
  color: var(--v64-on-surface-variant);
  font: var(--v64-type-label-md);
  letter-spacing: 0.08em;
  margin: 0;
  text-transform: uppercase;
}
.ai-advanced__group-note { color: var(--v64-on-surface-variant); font: var(--v64-type-body-md); margin: calc(var(--v64-space-2) * -1) 0 0; }
.ai-advanced__error p { margin: var(--v64-space-1) 0 var(--v64-space-3); }

@media (max-width: 599.98px) {
  .ai-advanced__toggle { padding: var(--v64-space-4); }
  .ai-advanced__body { padding: var(--v64-space-4); }
  .ai-advanced__actions .v-btn { flex: 1 1 auto; }
}
@media (prefers-reduced-motion: reduce) {
  .ai-advanced__chevron, .ai-advanced__toggle { transition: none; }
}
</style>
