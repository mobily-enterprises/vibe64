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

defineProps({
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
const accountRows = computed(() => {
  const rows = Array.isArray(accounts.status?.accounts) ? accounts.status.accounts : [];
  return rows.length
    ? rows.map(providerAccountRow)
    : [
        providerAccountRow({
          connected: false,
          id: "codex",
          label: "Codex",
          message: "Codex status has not loaded yet.",
          status: "unknown"
        }),
        providerAccountRow({
          connected: false,
          id: "github",
          label: "GitHub",
          message: "GitHub status has not loaded yet.",
          status: "unknown"
        })
      ];
});

function providerAccountRow(account = {}) {
  const id = String(account.id || "");
  return {
    ...account,
    authLabel: id === "github" ? "Auth GitHub" : "Auth Codex",
    deviceAuth: id === "codex"
  };
}

onMounted(() => {
  void accounts.refresh();
});
</script>
