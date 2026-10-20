<template>
  <div ref="root" class="vibe64-auth-settings">
    <v-menu location="bottom end">
      <template #activator="{ props: menuProps }">
        <v-btn
          v-bind="menuProps"
          :class="[
            'vibe64-auth-settings__button',
            credentialsNeedAttention ? 'vibe64-auth-settings__button--needs-attention' : ''
          ]"
          density="comfortable"
          :icon="mdiAccountCogOutline"
          size="large"
          title="Account"
          type="button"
          variant="tonal"
          aria-label="Account menu"
        />
      </template>
      <v-list class="vibe64-auth-settings__menu" density="comfortable">
        <v-list-item
          :prepend-icon="mdiAccountCogOutline"
          title="Account settings"
          @click="openDialog()"
        />
        <v-list-item
          v-if="aiOnboardingAvailable"
          :prepend-icon="mdiAutoFix"
          subtitle="Choose or switch your AI"
          title="Redo onboarding"
          @click="redoOnboarding"
        />
      </v-list>
    </v-menu>

    <v-dialog
      v-model="dialogOpen"
      :persistent="aiConnectionsBusy"
      max-width="1120"
      scrollable
    >
      <v-card class="vibe64-auth-settings__dialog" rounded="lg">
        <v-card-title class="vibe64-auth-settings__dialog-title">
          <div>
            <h2>Account settings</h2>
            <p>Choose how Vibe64 identifies you and connect its coding tools.</p>
          </div>
          <v-btn
            density="comfortable"
            :icon="mdiClose"
            title="Close account settings"
            :disabled="aiConnectionsBusy"
            type="button"
            variant="text"
            aria-label="Close account settings"
            @click="dialogOpen = false"
          />
        </v-card-title>
        <v-tabs
          v-model="selectedProviderId"
          class="vibe64-auth-settings__provider-tabs"
          color="primary"
          density="comfortable"
          show-arrows
        >
          <v-tab
            v-for="provider in providerOptions"
            :key="provider.id"
            class="vibe64-auth-settings__provider-tab"
            :prepend-icon="provider.icon"
            :value="provider.id"
            :disabled="aiConnectionsBusy"
          >
            {{ provider.label }}
            <span
              v-if="providerNeedsAttention(provider.id)"
              class="vibe64-auth-settings__provider-attention"
              aria-label="Needs attention"
            />
          </v-tab>
        </v-tabs>
        <v-divider />
        <v-card-text class="vibe64-auth-settings__dialog-body">
          <section
            v-if="selectedProviderId === 'profile'"
            class="vibe64-personal-profile"
            aria-labelledby="vibe64-personal-profile-title"
          >
            <div class="vibe64-personal-profile__heading">
              <h3 id="vibe64-personal-profile-title">Your profile</h3>
              <p>You — all projects</p>
            </div>
            <v-text-field
              ref="preferredNameField"
              v-model="preferredNameDraft"
              data-vibe64-personal-profile
              density="comfortable"
              :error-messages="preferredNameValidation.error ? [preferredNameValidation.error] : []"
              hide-details="auto"
              label="What should Vibe64 call you?"
              variant="outlined"
              @keydown.enter.prevent="savePreferredName"
            />
            <p class="vibe64-personal-profile__supporting-text">
              This name is used in Vibe64 welcomes and collaboration cues across this installation. Leave it blank to use your computer account name.
            </p>
            <div class="vibe64-personal-profile__actions">
              <v-btn
                class="vibe64-personal-profile__save"
                color="primary"
                :disabled="preferredNameSaving || !preferredNameChanged || !preferredNameValidation.valid"
                type="button"
                variant="flat"
                @click="savePreferredName"
              >
                {{ preferredNameSaving ? "Saving…" : "Save name" }}
              </v-btn>
            </div>
            <div class="vibe64-personal-profile__heading vibe64-personal-profile__appearance">
              <h3 id="vibe64-appearance-title">Appearance</h3>
              <p>This browser</p>
            </div>
            <v-btn-toggle
              :model-value="appearance"
              aria-labelledby="vibe64-appearance-title"
              class="vibe64-personal-profile__appearance-choice"
              color="primary"
              data-vibe64-appearance
              density="comfortable"
              divided
              mandatory
              rounded="xl"
              variant="outlined"
              @update:model-value="chooseAppearance"
            >
              <v-btn
                v-for="choice in appearanceChoices"
                :key="choice.value"
                :prepend-icon="choice.icon"
                :value="choice.value"
              >
                {{ choice.label }}
              </v-btn>
            </v-btn-toggle>
            <p class="vibe64-personal-profile__supporting-text">
              System follows your device's light or dark setting.
            </p>
          </section>
          <AiConnectionsSettings
            v-if="selectedProviderId === 'ai'"
            ref="aiConnectionsSettings"
            is-owner
            @busy="aiConnectionsBusy = $event"
          />
          <ProviderAccountsSetup
            v-if="selectedProviderId === 'github'"
            :accounts="accounts"
            :account-rows="selectedAccountRows"
            :status-loaded="statusLoaded"
            :title="selectedProviderTitle"
            :lede="selectedProviderLede"
            needed-label="Connection needed"
            ready-label="Connection ready"
            :show-continue="false"
          />
        </v-card-text>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useTheme } from "vuetify";
import { readAppearance, writeAppearance } from "@/lib/appearance.js";
import {
  mdiAccountOutline,
  mdiAccountCogOutline,
  mdiAutoFix,
  mdiClose,
  mdiMonitor,
  mdiWeatherNight,
  mdiWeatherSunny,
  mdiGithub,
  mdiRobotOutline
} from "@mdi/js";
import {
  accountRowsForStatus,
  ProviderAccountsSetup,
  AiConnectionsSettings,
  aiOnboardingAvailable,
  aiOnboardingBlocked,
  onVibe64AiOnboardingRequested,
  requestVibe64AiOnboarding,
  useVibe64Accounts
} from "@local/vibe64-accounts/client";
import {
  onVibe64AccountConnectionsDialogRequested
} from "@/lib/vibe64AccountConnectionsDialog.js";
import {
  preferredNameDraftState
} from "@/lib/vibe64PersonalAiProfile.js";

const accountProviderOptions = Object.freeze([
  {
    icon: mdiRobotOutline,
    id: "ai",
    label: "AI Accounts"
  },
  {
    icon: mdiGithub,
    id: "github",
    label: "GitHub"
  }
]);
const providerOptions = computed(() => [
  ...(personalProfileAvailable.value ? [{
    icon: mdiAccountOutline,
    id: "profile",
    label: "You"
  }] : []),
  ...accountProviderOptions
]);
const dialogOpen = ref(false);
const root = ref(null);
const theme = useTheme();
const appearance = ref(readAppearance());
const appearanceChoices = Object.freeze([
  { icon: mdiWeatherSunny, label: "Light", value: "light" },
  { icon: mdiWeatherNight, label: "Dark", value: "dark" },
  { icon: mdiMonitor, label: "System", value: "system" }
]);

function chooseAppearance(value) {
  if (!value) return;
  appearance.value = value;
  theme.change(value);
  writeAppearance(value);
}
const selectedProviderId = ref("ai");
const aiConnectionsSettings = ref(null);
const aiConnectionsBusy = ref(false);
const accounts = useVibe64Accounts();
const preferredNameField = ref(null);
const preferredNameDraft = ref("");
const preferredNameSaving = computed(() => accounts.savePersonalAiProfileCommand.isRunning === true);
const personalProfile = computed(() => accounts.status.value?.personalProfile || null);
const personalProfileAvailable = computed(() => personalProfile.value?.available === true);
const preferredNameValidation = computed(() => preferredNameDraftState(preferredNameDraft.value));
const preferredNameChanged = computed(() => (
  preferredNameValidation.value.preferredName !== String(personalProfile.value?.preferredName || "")
));
const statusLoaded = computed(() => {
  return Boolean(accounts.status.value && Array.isArray(accounts.status.value.accounts));
});
const allAccountRows = computed(() => {
  return accountRowsForStatus(accounts.status.value, ["github"], {
    includeFallbackRows: false
  });
});
const selectedAccountRows = computed(() => {
  return accountRowsForStatus(accounts.status.value, [selectedProviderId.value], {
    includeFallbackRows: true
  });
});
const selectedProvider = computed(() => {
  return providerOptions.value.find((provider) => provider.id === selectedProviderId.value) || providerOptions.value[0];
});
const selectedProviderTitle = computed(() => {
  return `${selectedProvider.value.label} Connection`;
});
const selectedProviderLede = computed(() => {
  if (selectedProvider.value.id === "github") {
    return "Configure the GitHub account and Git identity used by this local Vibe64 editor.";
  }
  return "Connect the AI accounts used by this Vibe64 editor.";
});
const credentialsNeedAttention = computed(() => {
  if (!statusLoaded.value) {
    return false;
  }
  return allAccountRows.value.some((account) => account.connected !== true);
});

function normalizeProviderId(providerId = "") {
  const normalized = String(providerId || "").trim();
  return providerOptions.value.some((provider) => provider.id === normalized) ? normalized : "";
}

async function openDialog(options = {}) {
  const profileRequested = String(options.section || "").trim() === "profile";
  const requestedAi = options.codexReconnectRequired === true ? "codex" : String(options.providerId || "").trim();
  const requestedProviderId = normalizeProviderId(requestedAi) || (requestedAi ? "ai" : "");
  if (requestedProviderId) {
    selectedProviderId.value = requestedProviderId;
  }
  dialogOpen.value = true;
  if (profileRequested) {
    await accounts.reloadLocalStatus();
  } else if (options.codexReconnectRequired === true) {
    await accounts.reloadLocalStatus();
  } else if (options.refresh !== false) {
    await accounts.refresh();
  }
  if (profileRequested && personalProfileAvailable.value) {
    selectedProviderId.value = "profile";
    await focusPreferredName();
    return;
  }
  if (requestedProviderId) {
    selectedProviderId.value = requestedProviderId;
    await nextTick();
    if (requestedProviderId === "ai" && requestedAi !== "ai") aiConnectionsSettings.value?.openProvider(requestedAi, options);
    return;
  }
  selectedProviderId.value = "ai";
}

async function focusPreferredName() {
  await nextTick();
  preferredNameField.value?.focus?.();
}

async function savePreferredName() {
  if (
    preferredNameSaving.value ||
    !preferredNameChanged.value ||
    !preferredNameValidation.value.valid
  ) {
    return;
  }
  await accounts.savePersonalAiProfile({
    preferredName: preferredNameValidation.value.preferredName
  });
}

function providerNeedsAttention(providerId = "") {
  return allAccountRows.value.some((account) => account.id === providerId && account.connected !== true);
}

function handleAccountConnectionsDialogRequest(event) {
  void openDialog(event?.detail || {});
}

function activatorElement() {
  return root.value?.querySelector(".vibe64-auth-settings__button") || null;
}

function redoOnboarding() {
  requestVibe64AiOnboarding({ start: "choose", returnFocus: activatorElement() });
}

// The flow replaces this dialog; focus returns to the menu, not a closed tab.
// While AI Accounts is busy, aiOnboardingBlocked stops requests reaching here.
function handleAiOnboardingRequest(event) {
  if (!dialogOpen.value) return;
  dialogOpen.value = false;
  if (event?.detail && !event.detail.returnFocus) event.detail.returnFocus = activatorElement();
}

let disposeAccountConnectionsDialogRequest = () => null;
let disposeAiOnboardingRequest = () => null;

onMounted(() => {
  disposeAccountConnectionsDialogRequest = onVibe64AccountConnectionsDialogRequested(handleAccountConnectionsDialogRequest);
  disposeAiOnboardingRequest = onVibe64AiOnboardingRequested(handleAiOnboardingRequest);
});

onBeforeUnmount(() => {
  disposeAccountConnectionsDialogRequest();
  disposeAiOnboardingRequest();
  aiOnboardingBlocked.value = false;
});

watch(() => dialogOpen.value && aiConnectionsBusy.value, (blocked) => {
  aiOnboardingBlocked.value = blocked;
});

watch(
  () => personalProfile.value?.preferredName,
  (preferredName) => {
    preferredNameDraft.value = String(preferredName || "");
  },
  { immediate: true }
);
</script>

<style scoped>
.vibe64-auth-settings {
  align-items: center;
  display: inline-flex;
  flex: 0 0 auto;
  justify-content: center;
  margin-inline-end: 0.75rem;
}

.vibe64-auth-settings__button {
  background: var(--studio-control-rest-bg, rgb(var(--v-theme-surface-variant))) !important;
  border: 1px solid var(--studio-control-border, rgba(var(--v-theme-on-surface), 0.12));
  box-shadow: none;
  color: var(--studio-control-text, rgb(var(--v-theme-on-surface))) !important;
  height: 2.75rem;
  min-height: 2.75rem;
  min-width: 2.75rem;
  overflow: visible;
  position: relative;
  width: 2.75rem;
}

.vibe64-auth-settings__button--needs-attention {
  background: rgba(var(--v-theme-warning), 0.18) !important;
  border-color: rgb(var(--v-theme-warning));
  color: rgb(var(--v-theme-warning)) !important;
}

.vibe64-auth-settings__button--needs-attention::after {
  animation: vibe64-auth-settings-pulse 6s ease-out infinite;
  border: 2px solid currentColor;
  border-radius: inherit;
  content: "";
  inset: -0.2rem;
  opacity: 0;
  pointer-events: none;
  position: absolute;
  transform: scale(1) translateZ(0);
  transform-origin: center;
  will-change: opacity, transform;
}

.vibe64-auth-settings__dialog {
  display: flex;
  flex-direction: column;
  max-height: min(88vh, 54rem);
  overflow: hidden;
}

.vibe64-auth-settings__dialog-title {
  align-items: start;
  display: flex;
  gap: 1rem;
  justify-content: flex-end;
  padding: 1rem 1rem 0.75rem;
}

.vibe64-auth-settings__dialog-title > div {
  flex: 1 1 auto;
  min-width: 0;
}

.vibe64-auth-settings__dialog-title h2 {
  font-size: 1.08rem;
  font-weight: 760;
  letter-spacing: 0;
  line-height: 1.2;
  margin: 0;
}

.vibe64-auth-settings__dialog-title p {
  color: rgba(var(--v-theme-on-surface), 0.66);
  font-size: 0.86rem;
  font-weight: 400;
  line-height: 1.35;
  margin: 0.18rem 0 0;
}

.vibe64-auth-settings__provider-tabs {
  flex: 0 0 auto;
  padding-inline: 0.75rem;
}

.vibe64-auth-settings__provider-tab {
  min-width: 8.5rem;
}

.vibe64-auth-settings__provider-attention {
  background: rgb(var(--v-theme-warning));
  border-radius: 999px;
  display: inline-block;
  height: 0.48rem;
  margin-inline-start: 0.45rem;
  width: 0.48rem;
}

.vibe64-auth-settings__dialog-body {
  flex: 1 1 auto;
  overflow: auto;
  padding: 1rem;
}

.vibe64-personal-profile__appearance {
  margin-top: 1.5rem;
}

.vibe64-personal-profile__appearance-choice {
  margin-top: 0.5rem;
}

.vibe64-personal-profile {
  display: grid;
  gap: 1rem;
  max-width: 38rem;
}

.vibe64-personal-profile__heading h3 {
  font-size: 1rem;
  font-weight: 720;
  line-height: 1.35;
  margin: 0;
}

.vibe64-personal-profile__heading p,
.vibe64-personal-profile__supporting-text {
  color: rgba(var(--v-theme-on-surface), 0.66);
  font-size: 0.82rem;
  line-height: 1.4;
  margin: 0.2rem 0 0;
}

.vibe64-personal-profile__actions {
  display: flex;
  justify-content: flex-end;
}

.vibe64-personal-profile__save {
  min-height: 3rem;
  min-width: 7.5rem;
}

@media (pointer: coarse) {
  .vibe64-auth-settings__button,
  .vibe64-auth-settings__provider-tab {
    min-height: 3rem;
  }
}

@keyframes vibe64-auth-settings-pulse {
  0% {
    opacity: 0.5;
    transform: scale(1) translateZ(0);
  }

  14% {
    opacity: 0;
    transform: scale(1.34) translateZ(0);
  }

  100% {
    opacity: 0;
    transform: scale(1.34) translateZ(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .vibe64-auth-settings__button--needs-attention::after {
    animation: none;
  }
}

@media (max-width: 720px) {
  .vibe64-auth-settings__dialog {
    max-height: 100vh;
  }

  .vibe64-auth-settings__provider-tab {
    min-width: 7.25rem;
  }

  .vibe64-auth-settings__dialog-body {
    padding: 0.85rem;
  }
}
</style>
