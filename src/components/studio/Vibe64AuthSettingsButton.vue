<template>
  <div class="vibe64-auth-settings">
    <v-btn
      :class="[
        'vibe64-auth-settings__button',
        credentialsNeedAttention ? 'vibe64-auth-settings__button--needs-attention' : ''
      ]"
      density="comfortable"
      :icon="mdiAccountCogOutline"
      size="large"
      title="Account settings"
      type="button"
      variant="tonal"
      aria-label="Account settings"
      @click="openDialog"
    />

    <v-dialog
      v-model="dialogOpen"
      :persistent="codexProviderSaving"
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
            :disabled="codexProviderSaving"
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
            :disabled="codexProviderSaving"
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
          </section>
          <CodexProviderConnections
            v-if="selectedProviderId === 'codex'"
            v-model="codexModelProviderId"
            @busy="codexProviderSaving = $event"
          />
          <ProviderAccountsSetup
            v-if="selectedProviderId !== 'profile' && (selectedProviderId !== 'codex' || codexModelProviderId === 'openai')"
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
import {
  mdiAccountOutline,
  mdiAccountCogOutline,
  mdiClose,
  mdiGithub,
  mdiRobotOutline
} from "@mdi/js";
import {
  accountRowsForStatus,
  ProviderAccountsSetup,
  CodexProviderConnections,
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
    id: "codex",
    label: "Codex"
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
const selectedProviderId = ref("codex");
const codexModelProviderId = ref("openai");
const codexProviderSaving = ref(false);
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
  return accountRowsForStatus(accounts.status.value, ["codex", "github"], {
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
  return "Configure the Codex account used by this local Vibe64 editor.";
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
  const requestedProviderId = normalizeProviderId(options.providerId);
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
    return;
  }
  const accountProviderId = firstAccountProviderNeedingAttention();
  if (accountProviderId) {
    selectedProviderId.value = accountProviderId;
  }
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

function firstAccountProviderNeedingAttention() {
  return allAccountRows.value.find((account) => account.connected !== true)?.id || "";
}

function providerNeedsAttention(providerId = "") {
  return allAccountRows.value.some((account) => account.id === providerId && account.connected !== true);
}

function handleAccountConnectionsDialogRequest(event) {
  void openDialog(event?.detail || {});
}

let disposeAccountConnectionsDialogRequest = () => null;

onMounted(() => {
  disposeAccountConnectionsDialogRequest = onVibe64AccountConnectionsDialogRequested(handleAccountConnectionsDialogRequest);
});

onBeforeUnmount(() => {
  disposeAccountConnectionsDialogRequest();
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
