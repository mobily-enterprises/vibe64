<script setup>
import { computed } from "vue";
import { useDisplay } from "vuetify";
import {
  mdiAccountCircleOutline,
  mdiArrowLeft,
  mdiClose,
  mdiCreditCardOutline,
  mdiEyeOffOutline,
  mdiEyeOutline,
  mdiLockOutline,
  mdiMagnify,
  mdiRobotOutline
} from "@mdi/js";
import AiWaitStatus from "./AiWaitStatus.vue";
import CliInstallNotice from "./CliInstallNotice.vue";
import ModelRoutingForm from "./ModelRoutingForm.vue";
import NativeProviderConnections from "./NativeProviderConnections.vue";
import ProviderAccountsSetup from "./ProviderAccountsSetup.vue";
import { injectAiConnectionManager } from "../composables/useAiConnectionManager.js";

// The dialogs behind adding, managing, routing and removing AI connections,
// moved from AI Accounts. They act on the screen's one connection manager.
const { smAndDown } = useDisplay();
const {
  addAiOpen,
  aiStatusLoaded,
  backFromNativeSetup,
  canAddConnection,
  catalogPreparationError,
  checkingOpenCode,
  checkOpenCodeAgain,
  chooseAiType,
  chooseNativeProvider,
  chooseProvider,
  closeEditor,
  codexProviders,
  codexProviderSaving,
  confirmModelAccessUnlock,
  confirmRemove,
  editorActivator,
  editorApiKey,
  editorApiKeyVisible,
  editorBackLabel,
  editorCanSave,
  editorCatalogModelCount,
  editorConnectionPolicy,
  editorError,
  editorEyebrow,
  editorLabel,
  editorOpen,
  editorOrigin,
  editorPreparing,
  editorProviderId,
  editorProviderRevision,
  editorRouteExplanation,
  editorRoutingPending,
  editorRoutingSetupError,
  editorSaving,
  editorTitle,
  editorVerificationCopy,
  emit,
  filteredProviders,
  finishConnectionRouting,
  isOwner,
  missingTool,
  modelAccessConfirmOpen,
  modelAccessRunning,
  modelAccessTarget,
  nativeAccounts,
  nativeAvailableProviders,
  nativeChoices,
  nativeConnected,
  nativeModelProviderId,
  nativeProviderPickerOpen,
  nativeRoutingReady,
  nativeRoutingSetupError,
  nativeSetupActivator,
  nativeSetupDetails,
  nativeSetupOpen,
  nativeSetupOrigin,
  nativeSetupProviderId,
  nativeSetupRows,
  nativeSetupToolProblem,
  openCodeAddAvailable,
  openProviderPicker,
  providerPickerLoading,
  providerPickerOpen,
  providerSearch,
  providerUnavailableReason,
  registryLoaded,
  registryLoadError,
  removeOpen,
  removeRunning,
  removeTarget,
  retryPreparedProvider,
  routingEngineId,
  routingOpen,
  routingSaving,
  saveEditor
} = injectAiConnectionManager();
const dialogClass = computed(() => ["ai-dialog", { "ai-dialog--compact": smAndDown.value }]);
</script>

<template>
  <v-dialog v-model="addAiOpen" :fullscreen="smAndDown" max-width="46rem">
    <v-card :class="dialogClass" :rounded="smAndDown ? 0 : 'xl'">
      <v-card-title class="vibe64-dialog-title">
        <span>
          <small class="vibe64-dialog-eyebrow">Add connection</small>
          <strong>Choose an orchestrator</strong>
        </span>
        <v-btn :icon="mdiClose" aria-label="Close Add connection" type="button" variant="text" @click="addAiOpen = false" />
      </v-card-title>
      <v-card-text class="vibe64-add-ai__body">
        <v-row align="stretch">
          <v-col v-for="choice in (aiStatusLoaded ? nativeChoices : [])" :key="choice.id" cols="12" sm="6">
            <v-card class="vibe64-add-ai__choice fill-height" rounded="xl" variant="outlined">
              <v-card-item>
                <template #prepend>
                  <v-avatar color="secondary" rounded="lg" size="52" variant="tonal">
                    <v-icon :icon="mdiAccountCircleOutline" size="28" />
                  </v-avatar>
                </template>
                <v-card-title>{{ choice.label }}</v-card-title>
                <v-card-subtitle>{{ missingTool(choice.id) ? "Not installed on this computer" : "Choose a provider" }}</v-card-subtitle>
              </v-card-item>
              <v-card-text class="vibe64-add-ai__choice-copy text-body-medium">
                {{ choice.providers.map(provider => provider.label).join(', ') }}
              </v-card-text>
              <v-card-actions class="vibe64-add-ai__choice-actions">
                <v-btn class="vibe64-add-ai__choice-action" block color="primary" type="button" variant="tonal" @click="chooseAiType(choice.id)">
                  Choose {{ choice.label }}
                </v-btn>
              </v-card-actions>
            </v-card>
          </v-col>
          <v-col v-if="openCodeAddAvailable" cols="12" :sm="nativeChoices.length ? 6 : 12">
            <v-skeleton-loader v-if="!registryLoaded && !registryLoadError" type="card" aria-label="Loading OpenCode connections" />
            <v-card v-else class="vibe64-add-ai__choice fill-height" rounded="xl" variant="outlined">
              <v-card-item>
                <template #prepend>
                  <v-avatar color="secondary" rounded="lg" size="52" variant="tonal">
                    <v-icon :icon="mdiRobotOutline" size="28" />
                  </v-avatar>
                </template>
                <v-card-title>OpenCode</v-card-title>
                <v-card-subtitle>{{ missingTool("opencode") ? "Not installed on this computer" : "Connect a provider API key" }}</v-card-subtitle>
              </v-card-item>
              <v-card-text class="vibe64-add-ai__choice-copy text-body-medium">
                Choose from OpenCode’s provider catalog. Add as many providers as you need; each key stays an independent connection.
              </v-card-text>
              <v-card-actions class="vibe64-add-ai__choice-actions">
                <v-btn class="vibe64-add-ai__choice-action" block color="primary" type="button" variant="tonal" @click="chooseAiType('opencode')">
                  Choose provider
                </v-btn>
              </v-card-actions>
            </v-card>
          </v-col>
        </v-row>
        <p v-if="!canAddConnection" class="text-body-medium">All available connections are configured. Use Manage to update them.</p>
      </v-card-text>
    </v-card>
  </v-dialog>

  <v-dialog v-model="nativeProviderPickerOpen" :fullscreen="smAndDown" max-width="42rem" scrollable>
    <v-card :class="dialogClass" :rounded="smAndDown ? 0 : 'xl'">
      <v-card-title class="vibe64-dialog-title">
        <span>
          <small class="vibe64-dialog-eyebrow">Add {{ nativeSetupDetails.label }} connection</small>
          <strong>Choose a provider</strong>
        </span>
        <v-btn :icon="mdiArrowLeft" aria-label="Back to orchestrators" variant="text" @click="nativeProviderPickerOpen = false; addAiOpen = true" />
      </v-card-title>
      <v-card-text>
        <v-list v-if="nativeAvailableProviders.length" lines="two">
          <v-list-item
            v-for="provider in nativeAvailableProviders" :key="provider.id"
            :title="provider.label" :subtitle="provider.description" @click="chooseNativeProvider(provider.id)"
          >
            <template #append><span class="text-label-large text-primary">Connect</span></template>
          </v-list-item>
        </v-list>
        <p v-else class="text-body-medium">All available {{ nativeSetupDetails.label }} connections are configured.</p>
      </v-card-text>
    </v-card>
  </v-dialog>

  <v-dialog v-model="providerPickerOpen" :fullscreen="smAndDown" max-width="46rem" scrollable>
    <v-card :class="dialogClass" :rounded="smAndDown ? 0 : 'xl'">
      <v-card-title class="vibe64-dialog-title">
        <span>
          <small class="vibe64-dialog-eyebrow">Add OpenCode connection</small>
          <strong>Choose a provider</strong>
        </span>
        <v-btn
          :icon="mdiArrowLeft"
          aria-label="Back to AI types"
          type="button"
          variant="text"
          @click="providerPickerOpen = false; addAiOpen = true"
        />
      </v-card-title>
      <v-card-text class="vibe64-provider-picker__body">
        <CliInstallNotice
          v-if="missingTool('opencode')" :account="missingTool('opencode')" :checking="checkingOpenCode"
          @check="checkOpenCodeAgain"
        />
        <template v-else>
          <v-text-field
            v-model="providerSearch"
            autofocus
            clearable
            :disabled="providerPickerLoading"
            hide-details
            :prepend-inner-icon="mdiMagnify"
            label="Search OpenCode providers"
            placeholder="Try OpenAI, Anthropic, GLM…"
            variant="outlined"
          />

          <div
            v-if="providerPickerLoading"
            aria-busy="true"
            aria-label="Loading OpenCode providers"
            class="vibe64-provider-picker__list"
          >
            <v-skeleton-loader v-for="index in 6" :key="index" type="list-item-avatar-two-line" />
          </div>

          <div v-else-if="registryLoadError" class="vibe64-provider-picker__recovery">
            <v-alert
              :text="registryLoadError"
              title="OpenCode providers could not load"
              type="error"
              variant="tonal"
            />
            <v-btn color="primary" type="button" variant="tonal" @click="openProviderPicker">Try again</v-btn>
          </div>

          <v-sheet
            v-else-if="filteredProviders.length"
            border
            class="vibe64-provider-picker__list"
            rounded="xl"
          >
            <v-list lines="two">
              <v-list-item
                v-for="provider in filteredProviders"
                :key="provider.id"
                class="vibe64-provider-picker__item"
                :disabled="Boolean(providerUnavailableReason(provider))"
                :subtitle="providerUnavailableReason(provider)
                  ? `${provider.id} · ${providerUnavailableReason(provider)}`
                  : `${provider.id} · ${provider.description}`"
                :title="provider.label"
                @click="chooseProvider(provider, { origin: 'provider-picker' })"
              >
                <template #prepend>
                  <v-avatar color="primary" size="44" variant="tonal">
                    <v-icon :icon="mdiRobotOutline" size="22" />
                  </v-avatar>
                </template>
                <template #append>
                  <span v-if="providerUnavailableReason(provider)" class="text-label-medium text-medium-emphasis">
                    More setup needed
                  </span>
                  <span v-else class="text-label-large text-primary">Connect</span>
                </template>
              </v-list-item>
            </v-list>
          </v-sheet>

          <v-sheet v-else class="vibe64-provider-picker__empty" color="surface-container-low" rounded="xl">
            <v-icon :icon="mdiRobotOutline" color="primary" size="36" />
            <strong>
              {{ providerSearch.trim()
                ? `No providers match “${providerSearch.trim()}”`
                : "Every OpenCode provider is already connected" }}
            </strong>
            <span class="text-body-medium text-medium-emphasis">
              {{ providerSearch.trim()
                ? "Try a provider name or its OpenCode ID."
                : "Manage an existing connection, or remove one before adding it again." }}
            </span>
          </v-sheet>
        </template>
      </v-card-text>
    </v-card>
  </v-dialog>

  <v-dialog
    v-model="nativeSetupOpen"
    :persistent="codexProviderSaving"
    :activator="nativeSetupActivator"
    :open-on-click="false"
    :fullscreen="smAndDown"
    max-width="42rem"
    scrollable
  >
    <v-card :class="dialogClass" :rounded="smAndDown ? 0 : 'xl'">
      <v-card-text class="vibe64-codex-setup__body">
        <ModelRoutingForm v-if="nativeRoutingReady" :engine-id="nativeSetupProviderId" :connection-id="nativeSetupProviderId === 'codex' ? 'openai' : 'anthropic'" :connection-label="nativeSetupProviderId === 'codex' ? 'Codex login' : 'Claude login'" :setup-error="nativeRoutingSetupError" @busy="codexProviderSaving = $event" @close="nativeSetupOpen = false" @saved="nativeSetupOpen = false; emit('changed')" />
        <NativeProviderConnections
          v-else
          v-model="nativeModelProviderId"
          :engine-id="nativeSetupProviderId"
          :select-provider="false"
          :adding="nativeSetupOrigin === 'add'"
          :show-back="nativeSetupOrigin === 'add'"
          :actions-enabled="isOwner"
          show-close
          @busy="codexProviderSaving = $event"
          @close="nativeSetupOpen = false"
          @back="backFromNativeSetup"
          @changed="codexProviders.resource.reload(); emit('changed')"
        />
        <ProviderAccountsSetup
          v-if="!nativeRoutingReady && ['openai', 'anthropic'].includes(nativeModelProviderId)"
          :accounts="nativeAccounts"
          :actions-enabled="isOwner"
          actions-disabled-message="Only the Vibe64 owner can manage this connection."
          :account-rows="nativeSetupRows"
          :back-label="nativeSetupOrigin === 'add' ? 'Back' : ''"
          :needed-label="nativeSetupToolProblem === 'not_installed' ? 'Not installed'
            : nativeSetupToolProblem ? `Didn't start` : 'Not connected'"
          ready-label="Connected"
          :show-continue="false"
          :status-loaded="aiStatusLoaded"
          :title="nativeSetupDetails.label"
          @back="backFromNativeSetup"
          @connected="nativeConnected"
        >
          <template #close>
            <v-btn
              :icon="mdiClose"
              :aria-label="`Close ${nativeSetupDetails.label} setup`"
              type="button"
              variant="text"
              @click="nativeSetupOpen = false"
            />
          </template>
        </ProviderAccountsSetup>
      </v-card-text>
    </v-card>
  </v-dialog>

  <v-dialog
    :model-value="editorOpen"
    :activator="editorActivator"
    :open-on-click="false"
    :fullscreen="smAndDown"
    max-width="40rem"
    :persistent="editorSaving || routingSaving"
    @update:model-value="open => { if (!open && !routingSaving) editorRoutingPending ? finishConnectionRouting() : closeEditor(); }"
  >
    <v-card :class="dialogClass" :rounded="smAndDown ? 0 : 'xl'">
      <v-card-title v-if="!editorRoutingPending" class="vibe64-dialog-title">
        <span>
          <small class="vibe64-dialog-eyebrow">{{ editorEyebrow }}</small>
          <strong>{{ editorTitle }}</strong>
        </span>
        <v-btn
          :icon="editorOrigin === 'direct' ? mdiClose : mdiArrowLeft"
          :aria-label="editorOrigin === 'direct' ? 'Close provider setup' : 'Back to AI choices'"
          :disabled="editorSaving"
          type="button"
          variant="text"
          @click="closeEditor"
        />
      </v-card-title>

      <v-card-text v-if="editorRoutingPending">
        <ModelRoutingForm engine-id="opencode" :connection-id="editorProviderId" :connection-label="editorLabel" :setup-error="editorRoutingSetupError" @busy="routingSaving = $event" @close="finishConnectionRouting" @saved="finishConnectionRouting" />
      </v-card-text>
      <v-card-text v-else-if="catalogPreparationError" class="vibe64-provider-editor__body">
        <v-alert
          border="start"
          :text="catalogPreparationError"
          title="Provider could not be confirmed"
          type="error"
          variant="tonal"
        />
        <div class="vibe64-provider-editor__recovery">
          <v-btn type="button" variant="text" @click="closeEditor">{{ editorBackLabel }}</v-btn>
          <v-btn color="primary" type="button" variant="tonal" @click="retryPreparedProvider">Try again</v-btn>
        </div>
      </v-card-text>

      <template v-else>
        <v-card-text
          :aria-busy="editorPreparing ? 'true' : undefined"
          class="vibe64-provider-editor__body"
        >
          <v-sheet class="vibe64-provider-editor__provider" rounded="lg">
            <v-avatar color="primary" size="44" variant="tonal">
              <v-icon :icon="mdiRobotOutline" size="24" />
            </v-avatar>
            <span>
              <strong>{{ editorLabel }}</strong>
              <small>
                {{ editorProviderId }}<template v-if="editorCatalogModelCount"> · {{ editorCatalogModelCount }} models found</template>
              </small>
            </span>
          </v-sheet>

          <v-sheet
            v-if="editorPreparing"
            aria-label="Loading current provider details"
            class="vibe64-provider-editor__route"
            rounded="lg"
          >
            <v-skeleton-loader type="heading, paragraph" />
          </v-sheet>

          <v-sheet v-else-if="editorConnectionPolicy" class="vibe64-provider-editor__route" rounded="lg">
            <span>
              <strong>{{ editorConnectionPolicy.routeLabel || editorConnectionPolicy.productLabel }}</strong>
              <v-chip
                :color="editorConnectionPolicy.accessLabel === 'Workspace use' ? 'primary' : 'warning'"
                size="x-small"
                variant="tonal"
              >
                {{ editorConnectionPolicy.accessLabel }}
              </v-chip>
            </span>
            <p>{{ editorRouteExplanation }}</p>
          </v-sheet>

          <v-text-field
            v-model="editorApiKey"
            autocomplete="new-password"
            :disabled="editorSaving"
            :error-messages="editorError ? [editorError] : []"
            hint="Paste the key for this provider. It will not be shown again."
            label="API key"
            persistent-hint
            :type="editorApiKeyVisible ? 'text' : 'password'"
            variant="outlined"
            @update:model-value="editorError = ''"
          >
            <template #append-inner>
              <v-btn
                :aria-label="editorApiKeyVisible ? 'Hide API key' : 'Show API key'"
                :disabled="editorSaving"
                :icon="editorApiKeyVisible ? mdiEyeOffOutline : mdiEyeOutline"
                type="button"
                variant="text"
                @click="editorApiKeyVisible = !editorApiKeyVisible"
              />
            </template>
          </v-text-field>

          <AiWaitStatus :active="editorPreparing || editorSaving" :label="editorVerificationCopy" />
          <div v-if="!editorPreparing && !editorSaving" aria-live="polite" class="vibe64-provider-editor__security">
            <v-icon :icon="mdiLockOutline" size="18" />
            <span>{{ editorVerificationCopy }}</span>
          </div>

          <v-alert
            v-if="!editorPreparing && (!editorProviderRevision || !editorConnectionPolicy)"
            text="Vibe64 could not confirm this provider's current OpenCode definition. Go back and try again."
            title="Provider confirmation required"
            type="warning"
            variant="tonal"
          />
        </v-card-text>
        <v-card-actions class="vibe64-provider-editor__actions">
          <v-btn :disabled="editorSaving" type="button" variant="text" @click="closeEditor">{{ editorBackLabel }}</v-btn>
          <v-btn
            :aria-busy="editorPreparing || editorSaving ? 'true' : undefined"
            color="primary"
            :disabled="!editorCanSave && !editorPreparing && !editorSaving"
            :loading="editorPreparing || editorSaving"
            type="button"
            variant="flat"
            @click="saveEditor"
          >
            Verify and connect
          </v-btn>
        </v-card-actions>
      </template>
    </v-card>
  </v-dialog>

  <v-dialog v-model="routingOpen" max-width="38rem" :fullscreen="smAndDown" :persistent="routingSaving" scrollable>
    <v-card :class="dialogClass" :rounded="smAndDown ? 0 : 'xl'">
      <v-card-text>
        <ModelRoutingForm v-if="routingOpen" :engine-id="routingEngineId" :readonly="!isOwner" @busy="routingSaving = $event" @close="routingOpen = false" @saved="routingOpen = false; emit('changed')" />
      </v-card-text>
    </v-card>
  </v-dialog>

  <v-dialog v-model="modelAccessConfirmOpen" max-width="31rem" persistent>
    <v-card :class="dialogClass" rounded="xl">
      <v-card-item class="vibe64-ai-connections__confirm-header">
        <template #prepend>
          <v-avatar color="warning" size="44" variant="tonal">
            <v-icon :icon="mdiCreditCardOutline" size="23" />
          </v-avatar>
        </template>
        <v-card-title>{{ modelAccessTarget?.modelAccess?.label || "Unlock provider models" }}?</v-card-title>
        <v-card-subtitle class="vibe64-ai-connections__confirm-subtitle">
          GLM-4.7 Flash stays available either way.
        </v-card-subtitle>
      </v-card-item>
      <v-card-text class="text-body-medium">
        {{ modelAccessTarget?.modelAccess?.warning || "These models may consume paid provider credit." }}
      </v-card-text>
      <v-card-actions class="vibe64-ai-connections__confirm-actions">
        <v-btn :disabled="modelAccessRunning" type="button" variant="text" @click="modelAccessConfirmOpen = false; modelAccessTarget = null">
          Keep free only
        </v-btn>
        <v-btn
          color="warning"
          :disabled="modelAccessRunning"
          type="button"
          variant="flat"
          @click="confirmModelAccessUnlock"
        >
          Unlock paid models
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="removeOpen" max-width="30rem" persistent>
    <v-card :class="dialogClass" rounded="xl">
      <v-card-title>
        Remove AI connection?
      </v-card-title>
      <v-card-text>
        <template v-if="removeTarget?.kind === 'codex-provider'">
          Remove the {{ removeTarget.providerLabel }} connection from {{ removeTarget.engineId === "claude" ? "Claude Code" : "Codex" }}?
          Turns using this key will stop. Conversations and files remain.
        </template>
        <template v-else>
          New and resumed turns using this AI will stop until the owner connects it again.
          Existing conversation and project history remain intact.
        </template>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn :disabled="removeRunning" type="button" variant="text" @click="removeOpen = false">Cancel</v-btn>
        <v-btn
          :aria-busy="removeRunning ? 'true' : undefined"
          color="error"
          :disabled="removeRunning"
          type="button"
          variant="flat"
          @click="confirmRemove"
        >
          Remove AI
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
/* One button shape with the AI setup screen. */
.ai-dialog :deep(.v-btn:not(.v-btn--icon)) {
  border-radius: var(--v64-shape-md);
  letter-spacing: 0;
  text-transform: none;
}

.vibe64-dialog-title,
.vibe64-provider-editor__provider,
.vibe64-provider-editor__route > span,
.vibe64-provider-editor__security,
.vibe64-provider-editor__recovery {
  display: flex;
}

.vibe64-add-ai__body > p,
.vibe64-provider-editor__route p {
  margin: 0;
}

.vibe64-dialog-eyebrow {
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.vibe64-provider-picker__body,
.vibe64-provider-picker__empty,
.vibe64-provider-picker__recovery,
.vibe64-provider-editor__body,
.vibe64-provider-editor__provider > span:last-child {
  display: grid;
}

.vibe64-provider-picker__body,
.vibe64-provider-picker__empty,
.vibe64-provider-picker__recovery,
.vibe64-provider-editor__body {
  gap: 1rem;
}

.vibe64-provider-editor__provider small {
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

.vibe64-provider-editor__route > span {
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.vibe64-provider-editor__security {
  align-items: center;
  font-size: 0.8125rem;
  gap: 0.5rem;
}

.vibe64-dialog-title {
  align-items: center;
  gap: 1rem;
  justify-content: space-between;
  padding: 1.25rem 1.5rem 0.5rem;
}

.vibe64-dialog-title > span {
  display: grid;
  gap: 0.15rem;
  min-width: 0;
  white-space: normal;
}

.vibe64-dialog-title strong {
  overflow-wrap: anywhere;
}

.vibe64-dialog-title > :last-child {
  flex: 0 0 auto;
}

.vibe64-add-ai__body,
.vibe64-provider-picker__body,
.vibe64-provider-editor__body {
  padding: 1rem 1.5rem 1.5rem;
}

.vibe64-add-ai__body {
  align-content: start;
  display: grid;
  gap: 1rem;
}

.vibe64-add-ai__choice {
  display: flex;
  flex-direction: column;
}

.vibe64-add-ai__choice-copy {
  flex: 1;
}

.vibe64-add-ai__choice-actions {
  padding: 0 1rem 1rem;
}

.vibe64-add-ai__choice-action {
  min-height: 3rem;
}

.vibe64-codex-setup__body {
  padding: 1.5rem;
}

.vibe64-provider-picker__list {
  border-color: rgba(var(--v-theme-outline), var(--v-border-opacity));
  overflow: hidden;
}

.vibe64-provider-picker__item {
  min-height: 4.75rem;
}

.vibe64-provider-picker__item + .vibe64-provider-picker__item {
  border-top: 1px solid rgba(var(--v-theme-outline), var(--v-border-opacity));
}

.vibe64-provider-picker__empty {
  justify-items: center;
  padding: 2.5rem 1.5rem;
  text-align: center;
}

.vibe64-provider-picker__recovery .v-btn {
  justify-self: end;
}

.vibe64-provider-editor__provider {
  align-items: center;
  background: rgba(var(--v-theme-primary), 0.06);
  border: 1px solid rgba(var(--v-theme-outline), var(--v-border-opacity));
  gap: 0.75rem;
  padding: 0.85rem;
}

.vibe64-provider-editor__provider > span:last-child {
  gap: 0.1rem;
}

.vibe64-provider-editor__route {
  background: rgba(var(--v-theme-primary), 0.06);
  border: 1px solid rgba(var(--v-theme-outline), var(--v-border-opacity));
  display: grid;
  gap: 0.45rem;
  padding: 0.85rem;
}

.vibe64-provider-editor__route p {
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
  font-size: 0.875rem;
  line-height: 1.45;
}

.vibe64-provider-editor__recovery {
  gap: 0.5rem;
  justify-content: flex-end;
}

.vibe64-provider-editor__actions {
  gap: 0.5rem;
  justify-content: flex-end;
  padding: 0 1.5rem 1.25rem;
}

.vibe64-ai-connections__confirm-header {
  padding: 1.25rem 1.25rem 0.5rem;
}

.vibe64-ai-connections__confirm-actions {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
  padding: 0.75rem 1.25rem 1.25rem;
}

.vibe64-ai-connections__confirm-subtitle {
  overflow: visible;
  text-overflow: initial;
  white-space: normal;
}

/* Phones: full-screen dialogs stack their actions, primary on top. */
.ai-dialog--compact .vibe64-provider-editor__actions,
.ai-dialog--compact .vibe64-provider-editor__recovery,
.ai-dialog--compact.ai-dialog .vibe64-ai-connections__confirm-actions {
  align-items: stretch;
  flex-direction: column-reverse;
}

.ai-dialog--compact .vibe64-provider-editor__actions .v-btn,
.ai-dialog--compact .vibe64-provider-editor__recovery .v-btn,
.ai-dialog--compact .vibe64-ai-connections__confirm-actions .v-btn {
  margin-inline-start: 0;
  width: 100%;
}

.ai-dialog--compact .vibe64-add-ai__body,
.ai-dialog--compact .vibe64-provider-picker__body,
.ai-dialog--compact .vibe64-provider-editor__body {
  padding: 1rem;
}

.ai-dialog--compact .vibe64-codex-setup__body {
  padding: 1rem;
}

@media (max-width: 600px) {
  .vibe64-ai-connections__confirm-actions {
    align-items: stretch;
    flex-direction: column-reverse;
  }

  .vibe64-ai-connections__confirm-actions .v-btn {
    margin-inline-start: 0;
    width: 100%;
  }
}
</style>
