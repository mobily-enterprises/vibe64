<script setup>
import { computed } from "vue";
import { useDisplay } from "vuetify";
import AiConnectionDialogs from "./AiConnectionDialogs.vue";
import { provideAiConnectionManager, useAiConnectionManager } from "../composables/useAiConnectionManager.js";
import {
  AI_CONNECTIONS_ENDPOINT
} from "../lib/accountsGateApi.js";
import {
  mdiAutoFix,
  mdiCheck,
  mdiCreditCardOutline,
  mdiLockOutline,
  mdiOpenInNew,
  mdiPlus,
  mdiRefresh,
  mdiShieldCheckOutline,
  mdiStopCircleOutline
} from "@mdi/js";

import { aiOnboardingAvailable } from "../onboarding/aiOnboardingEvents.js";

const props = defineProps({
  endpoint: { type: String, default: AI_CONNECTIONS_ENDPOINT },
  isOwner: {
    default: false,
    type: Boolean
  },
  ownerNotice: { type: String, default: "Only the Vibe64 owner can add, change, or remove AI accounts." }
});

const emit = defineEmits(["changed", "connected", "busy"]);
const { smAndDown } = useDisplay();
const manager = provideAiConnectionManager(useAiConnectionManager({ endpoint: props.endpoint, isOwner: computed(() => props.isOwner), emit }));
const {
  accountsInitialLoading,
  addAiOpen,
  applyZenModelAccess,
  busy,
  canAddConnection,
  chooseProvider,
  configuredAiGroups,
  configuredAiRows,
  connectedWorkflows,
  editorOpen,
  hasOwnAi,
  loadError,
  manageConfiguredAi,
  nativeLoadError,
  openOnboarding,
  pendingProvider,
  refreshAllAccounts,
  refreshingAll,
  requestModelAccess,
  requestRemove,
  routingEngineId,
  routingOpen,
  updatingModelAccessProviderId,
  zenAccessTitle,
  zenCheck,
  zenCheckIsRunning,
  zenCheckProgress,
  zenCheckSummary
} = manager;
defineExpose({ openProvider: manager.openProvider });
</script>

<template>
  <v-sheet
    border
    :class="['vibe64-ai-connections', { 'vibe64-ai-connections--compact': smAndDown }]"
    rounded="xl"
  >
    <div
      v-if="isOwner"
      class="vibe64-ai-connections__page-actions"
      aria-label="AI account actions"
    >
      <v-btn
        v-if="aiOnboardingAvailable"
        class="vibe64-ai-connections__redo"
        :disabled="busy"
        :prepend-icon="mdiAutoFix"
        type="button"
        variant="text"
        @click="openOnboarding(true)"
      >
        Redo onboarding
      </v-btn>
      <v-btn
        :icon="mdiRefresh"
        aria-label="Refresh AI accounts"
        :disabled="accountsInitialLoading || refreshingAll"
        type="button"
        variant="text"
        @click="refreshAllAccounts"
      />
      <v-btn
        color="primary"
        :disabled="accountsInitialLoading || Boolean(loadError) || Boolean(nativeLoadError) || !canAddConnection"
        :prepend-icon="mdiPlus"
        type="button"
        variant="flat"
        @click="addAiOpen = true"
      >
        Add connection
      </v-btn>
    </div>

    <v-alert
      v-if="!isOwner"
      :text="ownerNotice"
      title="Owner required"
      type="info"
      variant="tonal"
    />

    <template v-else>
      <div
        v-if="accountsInitialLoading"
        aria-busy="true"
        aria-label="Loading AI accounts"
        class="vibe64-ai-connections__list"
      >
        <v-skeleton-loader v-for="index in 3" :key="index" type="list-item-avatar-three-line, actions" />
      </div>

      <div v-else-if="loadError" class="vibe64-ai-connections__load-error">
        <v-alert :text="loadError" title="AI accounts could not load" type="error" variant="tonal" />
        <v-btn type="button" variant="tonal" @click="refreshAllAccounts">Try again</v-btn>
      </div>

      <template v-else>
        <v-alert
          v-if="nativeLoadError"
          :text="nativeLoadError"
          title="AI account status could not load"
          type="warning"
          variant="tonal"
        />

        <section
          v-if="!hasOwnAi && !nativeLoadError && aiOnboardingAvailable"
          aria-labelledby="vibe64-ai-connections-setup-title"
          class="vibe64-ai-connections__setup"
        >
          <span class="vibe64-ai-connections__setup-mark" aria-hidden="true">
            <v-icon :icon="mdiAutoFix" size="28" />
          </span>
          <div class="vibe64-ai-connections__setup-copy">
            <h2 id="vibe64-ai-connections-setup-title">Give Vibe64 a brilliant mind</h2>
            <p>Vibe64 is at its best with a frontier model such as Claude. Choosing one takes about two minutes.</p>
          </div>
          <v-btn
            class="vibe64-ai-connections__setup-action"
            color="primary"
            :disabled="busy"
            size="large"
            type="button"
            variant="flat"
            @click="openOnboarding(false)"
          >
            Set up your AI
          </v-btn>
        </section>

        <section v-if="configuredAiRows.length" aria-label="Configured AI accounts" class="vibe64-ai-connections__accounts">
          <v-sheet
            v-for="group in configuredAiGroups" :key="group.id" tag="section" :aria-label="group.label"
            border class="vibe64-ai-connections__account-list" rounded="xl"
          >
            <div class="d-flex align-center justify-space-between flex-wrap ga-2 vibe64-ai-connections__group-title">
              <h2 class="text-title-large">{{ group.label }}</h2>
              <v-btn
                v-if="connectedWorkflows.some(choice => choice.engineId === group.id)" variant="tonal"
                :aria-label="`Configure ${group.label} routing`" @click="routingEngineId = group.id; routingOpen = true"
              >
                Configure routing
              </v-btn>
            </div>
            <article
              v-for="account in group.accounts"
              :key="`${account.kind}:${account.id}`"
              class="vibe64-ai-connections__row"
            >
              <div class="vibe64-ai-connections__identity">
                <v-avatar :color="account.kind === 'codex-provider' && !account.connected ? 'warning' : 'success'" size="44" variant="tonal">
                  <v-icon :icon="account.kind === 'codex-provider' && !account.connected ? mdiRefresh : mdiCheck" size="22" />
                </v-avatar>
                <span>
                  <strong>
                    {{ account.providerLabel }}
                  </strong>
                  <small v-if="account.id === 'zai'">{{ account.billingLabel }}</small>
                  <small v-else>{{ account.billingLabel }}</small>
                  <small v-if="account.id === 'zai'">Free model ready for new sessions · {{ account.keyHint }}</small>
                  <small v-else>{{ account.modelLabel }} · {{ account.keyHint }}</small>
                </span>
              </div>

              <div class="vibe64-ai-connections__status" aria-label="Connection status">
                <v-chip
                  v-if="account.accessLabel"
                  :color="account.accessLabel === 'Workspace use' ? 'primary' : undefined"
                  size="small"
                  variant="tonal"
                >
                  {{ account.accessLabel }}
                </v-chip>
                <v-chip
                  v-if="account.preferred"
                  color="success"
                  size="small"
                  variant="tonal"
                >
                  Default
                </v-chip>
              </div>

              <div class="vibe64-ai-connections__row-actions">
                <v-btn
                  v-if="account.managementUrl"
                  :append-icon="mdiOpenInNew"
                  :href="account.managementUrl"
                  rel="noopener noreferrer"
                  target="_blank"
                  variant="text"
                >
                  Billing &amp; usage
                </v-btn>
                <v-btn type="button" variant="text" @click="manageConfiguredAi(account)">Manage</v-btn>
                <v-btn
                  v-if="account.removable !== false"
                  color="error"
                  type="button"
                  variant="text"
                  @click="requestRemove(account)"
                >
                  Remove
                </v-btn>
              </div>

              <v-sheet
                v-if="account.id === 'opencode' && account.modelAccess"
                class="vibe64-ai-connections__account-child vibe64-ai-connections__zen-access"
                rounded="md"
              >
                <small class="vibe64-ai-connections__account-child-label">For this connection</small>
                <div class="vibe64-ai-connections__model-access-copy">
                  <v-avatar
                    :color="account.modelAccess.mode === 'all' ? 'warning' : 'primary'"
                    size="40"
                    variant="tonal"
                  >
                    <v-icon
                      :icon="zenCheckIsRunning(account) ? mdiRefresh : mdiShieldCheckOutline"
                      size="21"
                    />
                  </v-avatar>
                  <span>
                    <strong>{{ zenAccessTitle(account) }}</strong>
                    <small>
                      The recommended Zen model always remains available. Checking sends one tiny, potentially billable request to each current Zen model, one at a time.
                    </small>
                  </span>
                </div>

                <div v-if="zenCheck(account).status" class="vibe64-ai-connections__zen-progress" aria-live="polite">
                  <v-progress-linear
                    v-if="zenCheckIsRunning(account)"
                    color="primary"
                    :indeterminate="!zenCheck(account).total"
                    :model-value="zenCheckProgress(account)"
                    rounded
                  />
                  <small>{{ zenCheckSummary(account) }}</small>
                </div>

                <div class="vibe64-ai-connections__zen-actions">
                  <v-btn
                    color="primary"
                    :disabled="Boolean(updatingModelAccessProviderId) || zenCheckIsRunning(account)"
                    type="button"
                    variant="flat"
                    @click="applyZenModelAccess(account, 'check-available')"
                  >
                    <span v-if="smAndDown">Check &amp; enable models</span>
                    <span v-else>Check &amp; enable working models</span>
                  </v-btn>
                  <v-btn
                    :disabled="Boolean(updatingModelAccessProviderId) || zenCheckIsRunning(account)"
                    type="button"
                    variant="tonal"
                    @click="applyZenModelAccess(account, 'enable-all')"
                  >
                    Enable all current models
                  </v-btn>
                  <v-btn
                    :disabled="Boolean(updatingModelAccessProviderId) || zenCheckIsRunning(account)"
                    type="button"
                    variant="text"
                    @click="applyZenModelAccess(account, 'disable-additional')"
                  >
                    Use the recommended model only
                  </v-btn>
                  <v-btn
                    v-if="zenCheckIsRunning(account)"
                    color="error"
                    :disabled="updatingModelAccessProviderId === account.id || zenCheck(account).status === 'cancelling'"
                    :prepend-icon="mdiStopCircleOutline"
                    type="button"
                    variant="text"
                    @click="applyZenModelAccess(account, 'cancel-check')"
                  >
                    {{ zenCheck(account).status === 'cancelling' ? "Stopping…" : "Cancel check" }}
                  </v-btn>
                </div>
              </v-sheet>

              <v-sheet
                v-if="account.id !== 'opencode' && account.modelAccess?.configurable"
                class="vibe64-ai-connections__account-child vibe64-ai-connections__model-access"
                :class="{ 'vibe64-ai-connections__model-access--paid': account.modelAccess.mode === 'all' }"
                rounded="md"
              >
                <small class="vibe64-ai-connections__account-child-label">For this connection</small>
                <div class="vibe64-ai-connections__model-access-copy">
                  <v-avatar
                    :color="account.modelAccess.mode === 'all' ? 'warning' : 'success'"
                    size="40"
                    variant="tonal"
                  >
                    <v-icon
                      :icon="account.modelAccess.mode === 'all' ? mdiCreditCardOutline : mdiShieldCheckOutline"
                      size="21"
                    />
                  </v-avatar>
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
                  color="primary"
                  :disabled="Boolean(updatingModelAccessProviderId)"
                  hide-details
                  inset
                  :label="updatingModelAccessProviderId === account.id
                    ? (account.modelAccess.mode === 'all' ? 'Returning to free only…' : 'Unlocking paid models…')
                    : account.modelAccess.label"
                  :model-value="account.modelAccess.mode === 'all'"
                  @click.prevent="requestModelAccess(account, account.modelAccess.mode !== 'all')"
                />
              </v-sheet>
            </article>
          </v-sheet>
        </section>

        <v-alert
          v-if="pendingProvider && !editorOpen"
          class="vibe64-ai-connections__requested"
          :text="`${pendingProvider.label} needs an API key before the requested OpenCode session can start.`"
          title="Provider setup requested"
          type="info"
          variant="tonal"
        >
          <template #append>
            <v-btn color="primary" type="button" variant="flat" @click="chooseProvider(pendingProvider)">Connect</v-btn>
          </template>
        </v-alert>

        <div class="vibe64-ai-connections__security-note">
          <v-icon :icon="mdiLockOutline" size="18" />
          <span>Provider keys are redacted after saving. Sign-ins and keys can be managed only by the Vibe64 owner.</span>
        </div>
      </template>
    </template>

    <AiConnectionDialogs />
  </v-sheet>
</template>

<style scoped>
.vibe64-ai-connections {
  display: grid;
  gap: 1.5rem;
  padding: clamp(1rem, 3vw, 1.5rem);
}

.vibe64-ai-connections__page-actions,
.vibe64-ai-connections__identity,
.vibe64-ai-connections__status,
.vibe64-ai-connections__row-actions,
.vibe64-ai-connections__model-access,
.vibe64-ai-connections__model-access-copy,
.vibe64-ai-connections__zen-actions,
.vibe64-ai-connections__security-note {
  display: flex;
}

.vibe64-ai-connections__page-actions,
.vibe64-ai-connections__status,
.vibe64-ai-connections__row-actions {
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.vibe64-ai-connections__page-actions {
  justify-content: flex-end;
}

.vibe64-ai-connections__redo {
  margin-inline-end: auto;
}

.vibe64-ai-connections__setup {
  align-items: center;
  background:
    radial-gradient(28rem 12rem at 100% 0%, var(--v64-primary-container), transparent 70%),
    var(--v64-surface-container-low);
  border: 1px solid var(--v64-outline-variant);
  border-radius: var(--v64-shape-xl);
  display: grid;
  gap: var(--v64-space-4) var(--v64-space-5);
  grid-template-columns: auto minmax(0, 1fr) auto;
  padding: var(--v64-space-5);
}

.vibe64-ai-connections__setup-mark {
  align-items: center;
  background: var(--v64-primary-container);
  border-radius: var(--v64-shape-lg);
  color: var(--v64-on-primary-container);
  display: inline-flex;
  height: 3.5rem;
  justify-content: center;
  width: 3.5rem;
}

.vibe64-ai-connections__setup-copy {
  display: grid;
  gap: var(--v64-space-1);
  min-width: 0;
}

.vibe64-ai-connections__setup-copy h2 {
  font: var(--v64-type-title-lg);
  margin: 0;
}

.vibe64-ai-connections__setup-copy p {
  color: var(--v64-on-surface-variant);
  font: var(--v64-type-body-md);
  margin: 0;
}

.vibe64-ai-connections__setup-action {
  min-height: 3rem;
}

.vibe64-ai-connections__list,
.vibe64-ai-connections__load-error,
.vibe64-ai-connections__accounts,
.vibe64-ai-connections__zen-access,
.vibe64-ai-connections__zen-progress {
  display: grid;
}

.vibe64-ai-connections__list,
.vibe64-ai-connections__load-error,
.vibe64-ai-connections__accounts {
  gap: 1rem;
}

.vibe64-ai-connections__account-list {
  overflow: hidden;
}

.vibe64-ai-connections__group-title {
  padding: 1rem 1rem 0;
}

.vibe64-ai-connections__row {
  align-items: center;
  display: grid;
  gap: 1rem;
  grid-template-columns: minmax(15rem, 1fr) auto auto;
  min-height: 5.75rem;
  padding: 1rem;
}

.vibe64-ai-connections__row + .vibe64-ai-connections__row {
  border-top: 1px solid rgba(var(--v-theme-outline), var(--v-border-opacity));
}

.vibe64-ai-connections__identity {
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
}

.vibe64-ai-connections__status {
  justify-content: flex-end;
}

.vibe64-ai-connections__row-actions {
  justify-content: flex-end;
}

.vibe64-ai-connections__identity > span:last-child {
  display: grid;
  gap: 0.15rem;
  min-width: 0;
}

.vibe64-ai-connections__identity strong,
.vibe64-ai-connections__identity small {
  overflow-wrap: anywhere;
}

.vibe64-ai-connections__identity small,
.vibe64-ai-connections__model-access small,
.vibe64-ai-connections__zen-access small {
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

.vibe64-ai-connections__model-access {
  align-items: center;
  background: rgba(var(--v-theme-primary), 0.05);
  border: 1px solid rgba(var(--v-theme-primary), 0.14);
  color: rgb(var(--v-theme-on-surface));
  flex-wrap: wrap;
  gap: 1rem;
  grid-column: 1 / -1;
  justify-content: space-between;
  padding: 0.75rem 1rem;
}

.vibe64-ai-connections__model-access--paid {
  background: rgba(var(--v-theme-warning), 0.1);
  border-color: rgba(var(--v-theme-warning), 0.2);
}

.vibe64-ai-connections__zen-access {
  background: rgba(var(--v-theme-primary), 0.05);
  border: 1px solid rgba(var(--v-theme-primary), 0.14);
  color: rgb(var(--v-theme-on-surface));
  gap: 0.75rem;
  grid-column: 1 / -1;
  padding: 0.9rem 1rem;
}

.vibe64-ai-connections__account-child {
  border-inline-start: 0.25rem solid rgba(var(--v-theme-primary), 0.55);
  margin-inline: 3.5rem 0.5rem;
  position: relative;
}

.vibe64-ai-connections__account-child::before {
  border-block-end: 2px solid rgba(var(--v-theme-primary), 0.35);
  border-end-start-radius: 0.5rem;
  border-inline-start: 2px solid rgba(var(--v-theme-primary), 0.35);
  block-size: 2.25rem;
  content: "";
  inline-size: 1.75rem;
  inset-block-start: -1rem;
  inset-inline-start: -2rem;
  position: absolute;
}

.vibe64-ai-connections__account-child-label {
  color: rgb(var(--v-theme-primary));
  flex: 0 0 auto;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  width: 100%;
}

.vibe64-ai-connections__zen-progress {
  gap: 0.35rem;
}

.vibe64-ai-connections__zen-actions {
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  min-width: 0;
  width: 100%;
}

.vibe64-ai-connections__model-access small {
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

.vibe64-ai-connections__model-access-copy {
  align-items: center;
  flex: 1 1 24rem;
  gap: 0.75rem;
  min-width: 0;
}

.vibe64-ai-connections__model-access-copy > span:last-child {
  display: grid;
  gap: 0.15rem;
  min-width: 0;
}

.vibe64-ai-connections__model-access .v-switch {
  flex: 0 0 auto;
}

.vibe64-ai-connections__security-note {
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

.vibe64-ai-connections__security-note {
  align-items: center;
  font-size: 0.8125rem;
  gap: 0.5rem;
}

.vibe64-ai-connections--compact .vibe64-ai-connections__page-actions,
.vibe64-ai-connections--compact .vibe64-ai-connections__row-actions {
  width: 100%;
}

.vibe64-ai-connections--compact .vibe64-ai-connections__setup {
  gap: var(--v64-space-3);
  grid-template-columns: minmax(0, 1fr);
  justify-items: start;
  padding: var(--v64-space-5) var(--v64-space-4) var(--v64-space-4);
}

.vibe64-ai-connections--compact .vibe64-ai-connections__setup-mark {
  height: 2.75rem;
  width: 2.75rem;
}

.vibe64-ai-connections--compact .vibe64-ai-connections__setup-action {
  width: 100%;
}

.vibe64-ai-connections--compact .vibe64-ai-connections__row {
  align-items: stretch;
  grid-template-columns: minmax(0, 1fr);
}

.vibe64-ai-connections--compact .vibe64-ai-connections__identity,
.vibe64-ai-connections--compact .vibe64-ai-connections__status,
.vibe64-ai-connections--compact .vibe64-ai-connections__row-actions,
.vibe64-ai-connections--compact .vibe64-ai-connections__model-access,
.vibe64-ai-connections--compact .vibe64-ai-connections__zen-access {
  grid-column: 1;
}

.vibe64-ai-connections--compact .vibe64-ai-connections__account-child {
  margin-inline: 1rem 0;
}

.vibe64-ai-connections--compact .vibe64-ai-connections__account-child::before {
  inline-size: 0.75rem;
  inset-inline-start: -1rem;
}

.vibe64-ai-connections--compact .vibe64-ai-connections__status,
.vibe64-ai-connections--compact .vibe64-ai-connections__row-actions {
  justify-content: flex-start;
}

.vibe64-ai-connections--compact .vibe64-ai-connections__row-actions .v-btn {
  flex: 1 1 auto;
}

.vibe64-ai-connections--compact .vibe64-ai-connections__model-access {
  align-items: stretch;
  flex-direction: column;
  flex-wrap: nowrap;
}

.vibe64-ai-connections--compact .vibe64-ai-connections__model-access-copy {
  flex: 0 1 auto;
  width: 100%;
}

.vibe64-ai-connections--compact .vibe64-ai-connections__model-access .v-switch {
  width: 100%;
}

.vibe64-ai-connections--compact .vibe64-ai-connections__zen-actions .v-btn {
  min-width: 0;
  width: 100%;
}
</style>
