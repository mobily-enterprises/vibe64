<template>
  <CodexProviderConnections v-if="providerId === 'codex'" v-model="codexProviderId" :actions-enabled="actionsEnabled" />
  <ProviderAccountsSetup
    v-if="providerId !== 'codex' || codexProviderId === 'openai'"
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
import { computed, ref } from "vue";
import CodexProviderConnections from "./CodexProviderConnections.vue";
import ProviderAccountsSetup from "./ProviderAccountsSetup.vue";
import { useVibe64Accounts } from "../composables/useVibe64Accounts.js";

const props = defineProps({
  actionsDisabledMessage: {
    default: "",
    type: String
  },
  actionsEnabled: {
    default: true,
    type: Boolean
  },
  accountsClient: {
    default: null,
    type: Object
  },
  providerId: { default: "codex", type: String },
  backLabel: {
    default: "",
    type: String
  },
  continueLabel: {
    default: "Continue",
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

const codexProviderId = ref("openai");
const emit = defineEmits(["back", "continue"]);
const accounts = useVibe64Accounts({
  client: props.accountsClient
});
const statusLoaded = computed(() => {
  return Boolean(accounts.status.value && Array.isArray(accounts.status.value.accounts));
});
const aiAccountRows = computed(() => {
  const rows = Array.isArray(accounts.status.value?.accounts) ? accounts.status.value.accounts : [];
  const account = rows.find((account) => String(account.id || "") === props.providerId);
  return [
    aiProviderRow(account || {
      connected: false,
      id: props.providerId,
      label: props.providerId === "claude" ? "Claude Code" : "Codex",
      message: "Account status has not loaded yet.",
      status: "unknown"
    })
  ];
});

function aiProviderRow(account = {}) {
  if (account.id === "claude") {
    return { ...account, authLabel: "Sign in with Claude", authMode: "browser", deviceAuth: false };
  }
  return {
    ...account,
    authLabel: "Login with ChatGPT",
    authMode: "device",
    deviceAuth: true
  };
}
</script>
