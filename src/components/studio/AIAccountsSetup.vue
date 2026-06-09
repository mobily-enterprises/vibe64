<template>
  <ProviderAccountsSetup
    :accounts="accounts"
    :actions-disabled-message="actionsDisabledMessage"
    :actions-enabled="actionsEnabled"
    :account-rows="aiAccountRows"
    :back-label="backLabel"
    :continue-label="continueLabel"
    :lede="lede"
    :needed-label="neededLabel"
    :ready-label="readyLabel"
    :show-continue="showContinue"
    :status-loaded="statusLoaded"
    :title="title"
    @back="emit('back')"
    @continue="emit('continue')"
  />
</template>

<script setup>
import { computed } from "vue";
import ProviderAccountsSetup from "@/components/studio/ProviderAccountsSetup.vue";
import { useVibe64Accounts } from "@/composables/useVibe64Accounts.js";

defineProps({
  actionsDisabledMessage: {
    default: "",
    type: String
  },
  actionsEnabled: {
    default: true,
    type: Boolean
  },
  backLabel: {
    default: "",
    type: String
  },
  continueLabel: {
    default: "Continue to Project Setup",
    type: String
  },
  lede: {
    default: "Authenticate the shared AI accounts this Vibe64 environment uses.",
    type: String
  },
  neededLabel: {
    default: "AI accounts needed",
    type: String
  },
  readyLabel: {
    default: "AI accounts ready",
    type: String
  },
  showContinue: {
    default: true,
    type: Boolean
  },
  title: {
    default: "AI Accounts",
    type: String
  }
});

const emit = defineEmits(["back", "continue"]);
const accounts = useVibe64Accounts();
const statusLoaded = computed(() => {
  return Boolean(accounts.status && Array.isArray(accounts.status.accounts));
});
const aiAccountRows = computed(() => {
  const rows = Array.isArray(accounts.status?.accounts) ? accounts.status.accounts : [];
  const codex = rows.find((account) => String(account.id || "") === "codex");
  return [
    aiProviderRow(codex || {
      connected: false,
      id: "codex",
      label: "Codex",
      message: "Codex status has not loaded yet.",
      status: "unknown"
    })
  ];
});

function aiProviderRow(account = {}) {
  return {
    ...account,
    authLabel: "Login with ChatGPT",
    authMode: "device",
    deviceAuth: true
  };
}
</script>
