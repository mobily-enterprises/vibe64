import { computed, ref, watch } from "vue";
import { normalizeObject } from "@jskit-ai/kernel/shared/support/normalize";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { useVibe64Accounts } from "./useVibe64Accounts.js";

const accountsSetupEmits = ["back", "continue"];
const accountsSetupProps = {
  accountsClient: {
    default: () => getHttpWebClient(),
    type: Object
  },
  backLabel: {
    default: "",
    type: String
  },
  autoContinueWhenReady: {
    default: false,
    type: Boolean
  },
  continueLabel: {
    default: "Continue",
    type: String
  },
  lede: {
    default: "Choose and authenticate the providers used by Studio.",
    type: String
  },
  neededLabel: {
    default: "Accounts needed",
    type: String
  },
  // Called once for each account that connects, so the host can act on it.
  onAccountConnected: {
    required: true,
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

/**
 * The accounts a setup screen asks for, as rows: with autoContinueWhenReady it continues once all are connected,
 * otherwise it tells the host about each account that connects.
 * @param {Readonly<import("vue").ExtractPropTypes<typeof accountsSetupProps>>} props
 * @param {(event: "continue") => void} emit
 */
function useAccountsSetup(props, emit) {
  const accounts = useVibe64Accounts({
    client: props.accountsClient
  });
  const autoContinueStarted = ref(false);
  const autoContinueVerificationActive = ref(false);
  const notifiedConnectedAccounts = new Set();
  const statusLoaded = computed(() => {
    return Boolean(accounts.status.value && Array.isArray(accounts.status.value.accounts));
  });
  const enabledProviderIds = computed(() => {
    return (Array.isArray(props.providerIds) ? props.providerIds : [])
      .map((providerId) => normalizeProviderId(providerId))
      .filter(Boolean);
  });
  const accountRows = computed(() => {
    return accountRowsForStatus(accounts.status.value, enabledProviderIds.value, {
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
      const liveStatus = result?.data || accounts.status.value || null;
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

// The status is null until accounts have been read.
function accountRowsForStatus(status, providerIds = [], {
  includeFallbackRows = false
} = {}) {
  const { accounts } = normalizeObject(status);
  const rows = Array.isArray(accounts) ? accounts : [];
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
