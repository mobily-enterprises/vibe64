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
      title="Account connections"
      type="button"
      variant="tonal"
      aria-label="Account connections"
      @click="openDialog"
    />

    <v-dialog
      v-model="dialogOpen"
      max-width="1120"
      scrollable
    >
      <v-sheet class="vibe64-auth-settings__dialog" rounded="lg">
        <div class="vibe64-auth-settings__dialog-actions">
          <v-btn
            density="comfortable"
            :icon="mdiClose"
            title="Close account connections"
            type="button"
            variant="text"
            aria-label="Close account connections"
            @click="dialogOpen = false"
          />
        </div>
        <v-btn-toggle
          v-model="selectedProviderId"
          class="vibe64-auth-settings__provider-toggle"
          density="comfortable"
          mandatory
          selected-class="vibe64-auth-settings__provider-toggle-item--selected"
          variant="outlined"
        >
          <v-btn
            v-for="provider in providerOptions"
            :key="provider.id"
            class="vibe64-auth-settings__provider-toggle-item"
            :prepend-icon="provider.icon"
            :value="provider.id"
          >
            {{ provider.label }}
          </v-btn>
        </v-btn-toggle>
        <ProviderAccountsSetup
          :accounts="accounts"
          :account-rows="selectedAccountRows"
          :status-loaded="statusLoaded"
          :title="selectedProviderTitle"
          :lede="selectedProviderLede"
          needed-label="Connection needed"
          ready-label="Connection ready"
          :show-continue="false"
        />
      </v-sheet>
    </v-dialog>
  </div>
</template>

<script setup>
import { computed, ref } from "vue";
import {
  mdiAccountCogOutline,
  mdiClose,
  mdiGithub,
  mdiRobotOutline
} from "@mdi/js";
import {
  accountRowsForStatus,
  ProviderAccountsSetup,
  useVibe64Accounts
} from "@local/vibe64-accounts/client";

const providerOptions = Object.freeze([
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
const dialogOpen = ref(false);
const selectedProviderId = ref("codex");
const accounts = useVibe64Accounts();
const statusLoaded = computed(() => {
  return Boolean(accounts.status && Array.isArray(accounts.status.accounts));
});
const allAccountRows = computed(() => {
  return accountRowsForStatus(accounts.status, providerOptions.map((provider) => provider.id), {
    includeFallbackRows: false
  });
});
const selectedAccountRows = computed(() => {
  return accountRowsForStatus(accounts.status, [selectedProviderId.value], {
    includeFallbackRows: true
  });
});
const selectedProvider = computed(() => {
  return providerOptions.find((provider) => provider.id === selectedProviderId.value) || providerOptions[0];
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

async function openDialog() {
  dialogOpen.value = true;
  await accounts.refresh();
}
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
  width: 2.75rem;
}

.vibe64-auth-settings__button--needs-attention {
  animation: vibe64-auth-settings-pulse 1.15s ease-in-out infinite;
  background: rgba(var(--v-theme-warning), 0.18) !important;
  border-color: rgb(var(--v-theme-warning));
  color: rgb(var(--v-theme-warning)) !important;
}

.vibe64-auth-settings__dialog {
  max-height: min(88vh, 54rem);
  overflow: auto;
  padding: 1rem;
  position: relative;
}

.vibe64-auth-settings__dialog-actions {
  display: flex;
  justify-content: flex-end;
  position: sticky;
  top: 0;
  z-index: 1;
}

.vibe64-auth-settings__provider-toggle {
  display: inline-flex;
  margin: 0 0 1rem;
}

.vibe64-auth-settings__provider-toggle-item {
  min-width: 8rem;
}

.vibe64-auth-settings__provider-toggle-item--selected {
  background: rgba(var(--v-theme-primary), 0.12);
}

@keyframes vibe64-auth-settings-pulse {
  0% {
    box-shadow:
      0 0 0 0 rgba(var(--v-theme-warning), 0.62),
      0 0 0 0.12rem rgba(var(--v-theme-warning), 0.24);
    transform: scale(1);
  }

  55% {
    box-shadow:
      0 0 0 0.72rem rgba(var(--v-theme-warning), 0),
      0 0 0 0.18rem rgba(var(--v-theme-warning), 0.34);
    transform: scale(1.08);
  }

  100% {
    box-shadow:
      0 0 0 0 rgba(var(--v-theme-warning), 0),
      0 0 0 0.12rem rgba(var(--v-theme-warning), 0.24);
    transform: scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .vibe64-auth-settings__button--needs-attention {
    animation: none;
  }
}
</style>
