<template>
  <ProviderAccountsSetup
    :accounts="accounts"
    :account-rows="accountRows"
    :back-label="backLabel"
    :continue-label="continueLabel"
    :lede="lede"
    :needed-label="neededLabel"
    :ready-label="readyLabel"
    :show-continue="showContinue"
    :title="title"
    @back="emit('back')"
    @continue="emit('continue')"
  />
</template>

<script setup>
import { computed, onMounted } from "vue";
import ProviderAccountsSetup from "@/components/studio/ProviderAccountsSetup.vue";
import { useVibe64Accounts } from "@/composables/useVibe64Accounts.js";

const props = defineProps({
  backLabel: {
    default: "",
    type: String
  },
  continueLabel: {
    default: "Continue to Project Setup",
    type: String
  },
  lede: {
    default: "Choose and authenticate the providers Studio uses for AI sessions and GitHub issue, pull request, and merge actions.",
    type: String
  },
  neededLabel: {
    default: "Accounts needed",
    type: String
  },
  providerIds: {
    default: () => ["codex", "github"],
    type: Array
  },
  readyLabel: {
    default: "Accounts ready",
    type: String
  },
  showContinue: {
    default: true,
    type: Boolean
  },
  title: {
    default: "Accounts",
    type: String
  }
});

const emit = defineEmits(["back", "continue"]);

const accounts = useVibe64Accounts();
const fallbackProviderRows = Object.freeze({
  codex: {
    connected: false,
    id: "codex",
    label: "Codex",
    message: "Codex status has not loaded yet.",
    status: "unknown"
  },
  github: {
    connected: false,
    id: "github",
    label: "GitHub",
    message: "GitHub status has not loaded yet.",
    status: "unknown"
  }
});
const enabledProviderIds = computed(() => {
  return (Array.isArray(props.providerIds) ? props.providerIds : [])
    .map((providerId) => normalizeProviderId(providerId))
    .filter(Boolean);
});
const accountRows = computed(() => {
  const rows = Array.isArray(accounts.status?.accounts) ? accounts.status.accounts : [];
  const rowsById = new Map(rows.map((account) => [normalizeProviderId(account?.id), account]));
  return enabledProviderIds.value
    .map((providerId) => rowsById.get(providerId) || fallbackProviderRows[providerId])
    .filter(Boolean)
    .map(providerAccountRow);
});

function normalizeProviderId(providerId = "") {
  return String(providerId || "").trim().toLowerCase();
}

function providerAccountRow(account = {}) {
  const id = String(account.id || "");
  return {
    ...account,
    authLabel: id === "github" ? "Sign in or create GitHub account" : "Auth Codex",
    deviceAuth: id === "codex",
    gitIdentityRequired: id === "github"
  };
}

onMounted(() => {
  void accounts.refresh();
});
</script>
