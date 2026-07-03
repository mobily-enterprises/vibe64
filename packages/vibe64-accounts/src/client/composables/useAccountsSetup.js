import { computed, ref, watch } from "vue";
import { useVibe64Accounts } from "./useVibe64Accounts.js";

const accountsSetupEmits = ["back", "continue"];
const accountsSetupProps = {
  backLabel: {
    default: "",
    type: String
  },
  autoContinueWhenReady: {
    default: false,
    type: Boolean
  },
  continueLabel: {
    default: "Continue to Project Setup",
    type: String
  },
  lede: {
    default: "Choose and authenticate the providers Studio uses for this project mode.",
    type: String
  },
  neededLabel: {
    default: "Accounts needed",
    type: String
  },
  onAccountConnected: {
    default: null,
    type: Function
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
};
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

function useAccountsSetup(props, emit) {
  const accounts = useVibe64Accounts();
  const autoContinueStarted = ref(false);
  const autoContinueVerificationActive = ref(false);
  const notifiedConnectedAccounts = new Set();
  const statusLoaded = computed(() => {
    return Boolean(accounts.status && Array.isArray(accounts.status.accounts));
  });
  const enabledProviderIds = computed(() => {
    return (Array.isArray(props.providerIds) ? props.providerIds : [])
      .map((providerId) => normalizeProviderId(providerId))
      .filter(Boolean);
  });
  const accountRows = computed(() => {
    return accountRowsForStatus(accounts.status, enabledProviderIds.value, {
      includeFallbackRows: true
    });
  });
  const allEnabledProvidersConnected = computed(() => {
    return allRowsConnected(accountRows.value);
  });

  watch(accountRows, (rows) => {
    if (props.autoContinueWhenReady) {
      if (allEnabledProvidersConnected.value && !autoContinueStarted.value) {
        void verifyAutoContinueReady();
      }
      return;
    }
    void notifyConnectedRows(rows);
  }, {
    immediate: true
  });

  return {
    accounts,
    accountRows,
    statusLoaded
  };

  async function verifyAutoContinueReady() {
    if (autoContinueStarted.value || autoContinueVerificationActive.value) {
      return;
    }
    autoContinueVerificationActive.value = true;
    try {
      const result = await accounts.refresh();
      const liveStatus = result?.data || accounts.status || null;
      const liveRows = accountRowsForStatus(liveStatus, enabledProviderIds.value);
      if (!allRowsConnected(liveRows) || autoContinueStarted.value) {
        return;
      }
      await notifyConnectedRows(liveRows);
      autoContinueStarted.value = true;
      emit("continue");
    } finally {
      autoContinueVerificationActive.value = false;
    }
  }

  async function notifyConnectedRows(rows = []) {
    if (typeof props.onAccountConnected !== "function") {
      return;
    }

    for (const row of rows) {
      if (row?.connected !== true) {
        continue;
      }
      const key = connectedAccountKey(row);
      if (!key || notifiedConnectedAccounts.has(key)) {
        continue;
      }
      notifiedConnectedAccounts.add(key);
      try {
        await props.onAccountConnected(row);
      } catch {
        notifiedConnectedAccounts.delete(key);
      }
    }
  }
}

function normalizeProviderId(providerId = "") {
  return String(providerId || "").trim().toLowerCase();
}

function accountRowsForStatus(status = {}, providerIds = [], {
  includeFallbackRows = false
} = {}) {
  const rows = Array.isArray(status?.accounts) ? status.accounts : [];
  const rowsById = new Map(rows.map((account) => [normalizeProviderId(account?.id), account]));
  return providerIds
    .map((providerId) => rowsById.get(providerId) || (includeFallbackRows ? fallbackProviderRows[providerId] : null))
    .filter(Boolean)
    .map(providerAccountRow);
}

function allRowsConnected(rows = []) {
  return rows.length > 0 && rows.every((row) => row.connected === true);
}

function providerAccountRow(account = {}) {
  const id = String(account.id || "");
  return {
    ...account,
    authLabel: id === "github" ? "Sign in or create GitHub account" : "Login with ChatGPT",
    authMode: id === "codex" ? "device" : "browser",
    deviceAuth: id === "codex",
    gitIdentityRequired: id === "github"
  };
}

function connectedAccountKey(account = {}) {
  const id = normalizeProviderId(account.id);
  if (!id) {
    return "";
  }
  const username = String(account.username || account.previousUsername || "").trim();
  return `${id}:${username}`;
}

export {
  accountRowsForStatus,
  accountsSetupEmits,
  accountsSetupProps,
  useAccountsSetup
};
