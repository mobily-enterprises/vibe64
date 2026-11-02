<script setup>
import { computed } from "vue";
import { mdiCheck, mdiOpenInNew, mdiShieldLockOutline } from "@mdi/js";
import AIAccountsSetup from "../studio/AIAccountsSetup.vue";
import AiWaitStatus from "../studio/AiWaitStatus.vue";
import CliInstallNotice from "../studio/CliInstallNotice.vue";
import NativeProviderConnections from "../studio/NativeProviderConnections.vue";
import AiOnboardingKeyConnect from "./AiOnboardingKeyConnect.vue";

// The connect screen's two steps for the chosen card: get a plan, then connect
// it through its own sign-in, key or provider form, with the check finishing
// runs and its warnings. A missing AI tool leads with installing it.
const props = defineProps({
  card: { type: Object, required: true },
  // How step 1 stands: "" (not yet), "opened" (sign-up page opened) or "have".
  signUp: { type: String, default: "" },
  // The card's AI tool, when this computer lacks it or it did not start.
  missingTool: { type: Object, default: null },
  checkingTools: Boolean,
  // Finishing is checking the provider, with what it says while it does.
  verifying: Boolean,
  verifyLabel: { type: String, default: "" },
  warning: { type: String, default: "" },
  // Connected, but no model is ready for Colleague yet.
  notReady: Boolean,
  busy: Boolean
});
// finish: the provider is connected; back: choose another AI; check: look for
// the AI tool again; busy: a connect form is working.
const emit = defineEmits(["update:signUp", "finish", "back", "check", "busy", "review-routing"]);
const nativeLogin = computed(() => ["anthropic", "openai"].includes(props.card.connect.modelProviderId));
</script>

<template>
  <ol class="aio-checklist">
    <li :class="{ 'is-done': signUp === 'opened' }">
      <span class="aio-checklist__marker" aria-hidden="true">
        <v-icon v-if="signUp === 'opened'" :icon="mdiCheck" size="18" /><template v-else>1</template>
      </span>
      <div>
        <h2 class="aio-checklist__title">
          {{ signUp === "have" ? card.haveTitle : "Get a plan" }}<span v-if="signUp === 'opened'" class="d-sr-only"> (done)</span>
        </h2>
        <p class="aio-checklist__body">
          {{ signUp === "have" ? "Go straight to the next step. Need one after all? Open the sign-up page." : [card.signUp.step, card.plan.budget].filter(Boolean).join(" ") }}
        </p>
        <v-btn
          variant="tonal" color="primary" :href="card.signUp.url" target="_blank" rel="noopener noreferrer"
          :append-icon="mdiOpenInNew" @click="emit('update:signUp', 'opened')"
        >
          {{ card.signUp.label }}<span class="d-sr-only"> (opens in a new tab)</span>
        </v-btn>
      </div>
    </li>
    <li>
      <span class="aio-checklist__marker" aria-hidden="true">2</span>
      <div class="aio-checklist__setup">
        <h2 class="aio-checklist__title">{{ card.connectStep.title }}</h2>
        <p class="aio-checklist__body">{{ card.connectStep.body }}</p>
        <AIAccountsSetup
          v-if="nativeLogin" embedded :provider-id="card.connect.engineId"
          :model-provider-id="card.connect.modelProviderId" @connected="emit('finish')" @back="emit('back')"
        />
        <CliInstallNotice v-else-if="missingTool" :account="missingTool" :checking="checkingTools" @check="emit('check')">
          <v-btn variant="text" @click="emit('back')">Choose another AI</v-btn>
        </CliInstallNotice>
        <AiOnboardingKeyConnect
          v-else-if="card.connect.engineId === 'opencode'" :model-provider-id="card.connect.modelProviderId"
          :label="card.name" @busy="emit('busy', $event)" @connected="emit('finish')"
        />
        <NativeProviderConnections
          v-else embedded adding :select-provider="false" :engine-id="card.connect.engineId"
          :model-value="card.connect.modelProviderId" @busy="emit('busy', $event)" @close="emit('finish')"
        />
        <AiWaitStatus :active="verifying" :label="verifyLabel" class="mt-4" />
        <v-alert v-if="warning" type="warning" variant="tonal" class="mt-4">
          {{ warning }}
          <template #append><v-btn variant="text" :disabled="busy" @click="emit('finish')">Try again</v-btn></template>
        </v-alert>
        <v-alert v-if="notReady" type="warning" variant="tonal" class="mt-4">
          {{ card.name }} is connected, but no model is ready for Colleague yet.
          <template #append><v-btn variant="text" @click="emit('review-routing')">Review models</v-btn></template>
        </v-alert>
        <p v-if="nativeLogin" class="ai-onboarding__security">
          <v-icon :icon="mdiShieldLockOutline" size="18" aria-hidden="true" />
          Your sign-in is stored privately, outside your projects.
        </p>
      </div>
    </li>
  </ol>
</template>

<style scoped>
.aio-checklist { display: grid; gap: var(--v64-space-6); list-style: none; margin: 0; padding: 0; }
.aio-checklist li { display: grid; gap: var(--v64-space-4); grid-template-columns: 32px minmax(0, 1fr); }
.aio-checklist__marker {
  align-items: center;
  border: 1.5px solid var(--v64-outline);
  border-radius: var(--v64-shape-full);
  display: inline-flex;
  font: var(--v64-type-label-lg);
  height: 32px;
  justify-content: center;
  width: 32px;
}
.aio-checklist .is-done .aio-checklist__marker { background: var(--v64-primary); border-color: var(--v64-primary); color: var(--v64-on-primary); }
.aio-checklist__title { font: var(--v64-type-title-md); margin: 4px 0 0; }
.aio-checklist__body { color: var(--v64-on-surface-variant); font: var(--v64-type-body-md); margin: 4px 0 var(--v64-space-4); }
.aio-checklist__setup { min-width: 0; }
/* The embedded sign-in sits flat inside its step. */
.aio-checklist__setup :deep(.accounts-setup__item) { background: transparent; border: 0 !important; padding: 0 !important; }
.ai-onboarding__security { align-items: center; color: var(--v64-on-surface-variant); display: flex; font: var(--aio-type-body-sm); gap: var(--v64-space-2); margin: var(--v64-space-4) 0 0; }
</style>
