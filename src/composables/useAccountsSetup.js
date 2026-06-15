import { computed, ref, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { useVibe64Accounts } from "@/composables/useVibe64Accounts.js";
import {
  VIBE64_SURFACE_ID
} from "@/lib/vibe64RequestConfig.js";

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
  const syncedGithubUsers = new Set();
  const autoContinueStarted = ref(false);
  const autoContinueVerificationActive = ref(false);
  const syncGithubIdentityCommand = useCommand({
    access: "never",
    apiSuffix: "/vibe64/github/identity/sync",
    buildCommandOptions: () => ({
      method: "POST",
      path: "/api/vibe64/github/identity/sync"
    }),
    buildRawPayload: () => ({}),
    fallbackRunError: "GitHub identity could not be synced.",
    messages: {
      error: "GitHub identity could not be synced.",
      success: "GitHub identity synced."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.github.identity.sync",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });
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

    syncGithubIdentityForRows(rows);
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
      syncGithubIdentityForRows(liveRows);
      autoContinueStarted.value = true;
      emit("continue");
    } finally {
      autoContinueVerificationActive.value = false;
    }
  }

  function syncGithubIdentityForRows(rows = []) {
    const github = rows.find((row) => row.id === "github" && row.connected === true);
    const username = String(github?.username || "").trim();
    if (!username || syncedGithubUsers.has(username)) {
      return;
    }
    syncedGithubUsers.add(username);
    void syncGithubIdentityCommand.run().catch(() => {
      syncedGithubUsers.delete(username);
    });
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

export {
  accountsSetupEmits,
  accountsSetupProps,
  useAccountsSetup
};
