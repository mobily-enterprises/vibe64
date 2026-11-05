<script setup>
import { mdiEyeOffOutline, mdiEyeOutline, mdiLockOutline, mdiRobotOutline } from "@mdi/js";
import AiPersonalUse from "./AiPersonalUse.vue";
import AiWaitStatus from "./AiWaitStatus.vue";
import { injectAiConnectionManager } from "../composables/useAiConnectionManager.js";

// The OpenCode key editor's form: the provider, who may use its connection,
// and its API key with the check that runs before it is stored.
const {
  editorApiKey,
  editorApiKeyVisible,
  editorCatalogModelCount,
  editorConnectionPolicy,
  editorError,
  editorLabel,
  editorPreparing,
  editorProviderId,
  editorProviderRevision,
  editorRouteExplanation,
  editorSaving,
  editorVerificationCopy
} = injectAiConnectionManager();
</script>

<template>
  <v-card-text :aria-busy="editorPreparing ? 'true' : undefined">
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
        <v-chip v-if="editorConnectionPolicy.accessLabel === 'Workspace use'" color="primary" size="x-small" variant="tonal">
          {{ editorConnectionPolicy.accessLabel }}
        </v-chip>
        <AiPersonalUse v-else :provider-id="editorProviderId" />
      </span>
      <p>{{ editorRouteExplanation }}</p>
    </v-sheet>

    <v-text-field
      v-model="editorApiKey"
      autocomplete="new-password"
      :disabled="editorSaving"
      :error-messages="editorError"
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
</template>

<style scoped>
.vibe64-provider-editor__provider {
  align-items: center;
  background: rgba(var(--v-theme-primary), 0.06);
  border: 1px solid var(--v64-outline-variant);
  display: flex;
  gap: 0.75rem;
  padding: 0.85rem;
}

.vibe64-provider-editor__provider > span:last-child {
  display: grid;
  gap: 0.1rem;
}

.vibe64-provider-editor__provider small {
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

.vibe64-provider-editor__route {
  background: rgba(var(--v-theme-primary), 0.06);
  border: 1px solid var(--v64-outline-variant);
  display: grid;
  gap: 0.45rem;
  padding: 0.85rem;
}

.vibe64-provider-editor__route > span {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.vibe64-provider-editor__route p {
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
  font-size: 0.875rem;
  line-height: 1.45;
  margin: 0;
}

.vibe64-provider-editor__security {
  align-items: center;
  display: flex;
  font-size: 0.8125rem;
  gap: 0.5rem;
}
</style>
