<template>
  <section class="accounts-setup">
    <header class="accounts-setup__header">
      <div>
        <h1 class="accounts-setup__title">{{ title }}</h1>
        <p class="accounts-setup__lede">
          {{ lede }}
        </p>
      </div>
      <div class="accounts-setup__header-actions">
        <v-chip
          :color="statusReady ? 'success' : 'warning'"
          variant="tonal"
        >
          {{ statusReady ? readyLabel : neededLabel }}
        </v-chip>
        <v-btn
          v-if="backLabel"
          color="primary"
          variant="tonal"
          @click="emit('back')"
        >
          {{ backLabel }}
        </v-btn>
        <v-btn
          color="primary"
          variant="tonal"
          :loading="accounts.isLoading"
          :prepend-icon="mdiRefresh"
          @click="authSessions.refreshStatus"
        >
          Refresh
        </v-btn>
        <v-btn
          v-if="statusReady && showContinue"
          color="primary"
          variant="flat"
          @click="emit('continue')"
        >
          {{ continueLabel }}
        </v-btn>
      </div>
    </header>

    <v-alert
      v-if="errorMessage"
      type="error"
      variant="tonal"
      border="start"
    >
      {{ errorMessage }}
    </v-alert>

    <v-progress-linear
      v-if="accounts.isLoading && !status"
      color="primary"
      height="6"
      indeterminate
      rounded
    />

    <div class="accounts-setup__items">
      <v-sheet
        v-for="account in accountRows"
        :key="account.id"
        rounded="lg"
        border
        :class="[
          'accounts-setup__item',
          account.connected ? 'accounts-setup__item--connected' : 'accounts-setup__item--missing'
        ]"
      >
        <div class="accounts-setup__item-main">
          <v-icon
            :icon="account.connected ? mdiCheckCircle : mdiAlertCircleOutline"
            :color="account.connected ? 'success' : 'warning'"
            size="30"
          />
          <div>
            <h2 class="accounts-setup__item-title">{{ account.label }}</h2>
            <p class="accounts-setup__item-message">
              {{ account.message || accountStatusMessage(account) }}
            </p>
            <p
              v-if="account.username"
              class="accounts-setup__identity"
            >
              {{ account.username }}
            </p>
          </div>
        </div>

        <div class="accounts-setup__actions">
          <v-btn
            color="primary"
            variant="flat"
            :disabled="authSessions.loginDisabled(account)"
            :loading="authSessions.activeSessionFor(account.id)?.status === 'authenticating'"
            @click="authSessions.startBrowserAuth(account.id)"
          >
            {{ account.id === "github" ? "Auth GitHub" : "Auth Codex" }}
          </v-btn>
          <v-btn
            v-if="account.id === 'codex'"
            color="primary"
            variant="tonal"
            :disabled="authSessions.loginDisabled(account)"
            @click="authSessions.startDeviceAuth"
          >
            Use code login
          </v-btn>
          <v-btn
            color="warning"
            variant="tonal"
            :disabled="authSessions.authBusy || !account.connected"
            :loading="authSessions.logoutAccountId === account.id"
            @click="authSessions.logoutAccount(account.id)"
          >
            Logout
          </v-btn>
        </div>

        <div
          v-if="authSessions.activeSessionFor(account.id)"
          class="accounts-setup__session"
        >
          <div
            v-if="authSessions.activeSessionFor(account.id)?.userCode"
            class="accounts-setup__code-block"
          >
            <p class="accounts-setup__code-label">One-time code</p>
            <p class="accounts-setup__code">{{ authSessions.activeSessionFor(account.id).userCode }}</p>
            <p
              v-if="authSessions.activeSessionFor(account.id)?.mode === 'device'"
              class="accounts-setup__code-help"
            >
              Enable code login in ChatGPT settings or workspace permissions, then enter this code on the login page.
            </p>
          </div>

          <div class="accounts-setup__session-actions">
            <v-btn
              v-if="authSessions.activeSessionFor(account.id)?.authUrl"
              color="primary"
              variant="tonal"
              @click="authSessions.openAuthUrl(authSessions.activeSessionFor(account.id))"
            >
              Open browser
            </v-btn>
            <v-btn
              v-if="authSessions.activeSessionFor(account.id)?.authUrl"
              color="primary"
              variant="tonal"
              :prepend-icon="mdiContentCopy"
              @click="authSessions.copyAuthUrl(authSessions.activeSessionFor(account.id))"
            >
              Copy auth link
            </v-btn>
            <v-btn
              variant="tonal"
              :disabled="authSessions.activeSessionFor(account.id)?.terminalStatus !== 'running'"
              @click="authSessions.cancelSession(authSessions.activeSessionFor(account.id))"
            >
              Cancel
            </v-btn>
          </div>

          <p
            v-if="authSessions.authLinkCopyStatus[authSessions.activeSessionFor(account.id)?.id]"
            class="accounts-setup__copy-status"
          >
            {{ authSessions.authLinkCopyStatus[authSessions.activeSessionFor(account.id).id] }}
          </p>

          <p class="accounts-setup__session-status">
            {{ sessionStatusMessage(authSessions.activeSessionFor(account.id)) }}
          </p>

          <details
            v-if="authSessions.activeSessionFor(account.id)?.status === 'failed'"
            class="accounts-setup__logs"
            open
          >
            <summary>Show login logs</summary>
            <pre>{{ authSessions.activeSessionFor(account.id).output }}</pre>
          </details>
        </div>
      </v-sheet>
    </div>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted } from "vue";
import {
  mdiAlertCircleOutline,
  mdiCheckCircle,
  mdiContentCopy,
  mdiRefresh
} from "@mdi/js";
import { useVibe64Accounts } from "@/composables/useVibe64Accounts.js";
import { useAccountAuthSessions } from "@/composables/useAccountAuthSessions.js";

defineProps({
  backLabel: {
    default: "",
    type: String
  },
  continueLabel: {
    default: "Continue to Adapter Setup",
    type: String
  },
  lede: {
    default: "Choose and authenticate the providers Studio uses for AI sessions and GitHub issue, pull request, and merge actions.",
    type: String
  },
  neededLabel: {
    default: "Connections needed",
    type: String
  },
  readyLabel: {
    default: "Connections ready",
    type: String
  },
  showContinue: {
    default: true,
    type: Boolean
  },
  title: {
    default: "Connections",
    type: String
  }
});

const emit = defineEmits(["back", "continue"]);

const accounts = useVibe64Accounts();
const status = computed(() => accounts.status || null);
const statusReady = computed(() => status.value?.ready === true);
const accountRows = computed(() => {
  const rows = Array.isArray(status.value?.accounts) ? status.value.accounts : [];
  return rows.length
    ? rows
    : [
        {
          connected: false,
          id: "codex",
          label: "Codex",
          message: "Codex status has not loaded yet.",
          status: "unknown"
        },
        {
          connected: false,
          id: "github",
          label: "GitHub",
          message: "GitHub status has not loaded yet.",
          status: "unknown"
        }
      ];
});
const authSessions = useAccountAuthSessions(accounts, {
  accountRows
});
const errorMessage = computed(() => authSessions.errorMessage);

function accountStatusMessage(account = {}) {
  return account.connected ? `${account.label} is connected.` : `${account.label} is not connected.`;
}

function sessionStatusMessage(session = {}) {
  if (session.status === "connected") {
    return `${session.account?.label || "Account"} is connected.`;
  }
  if (session.status === "failed") {
    return "Login did not finish cleanly. Review the logs and try again.";
  }
  if (session.authUrl) {
    return "Browser login is open. Complete authorization there, then Studio will continue.";
  }
  return "Starting login and waiting for the browser URL.";
}

onMounted(() => {
  void authSessions.refreshStatus();
});

onBeforeUnmount(() => {
  authSessions.stopPolling();
});
</script>

<style scoped>
.accounts-setup {
  display: grid;
  gap: 0.9rem;
  margin-inline: auto;
  max-width: 68rem;
}

.accounts-setup__header {
  align-items: end;
  display: flex;
  gap: 1rem;
  justify-content: space-between;
}

.accounts-setup__header-actions,
.accounts-setup__actions,
.accounts-setup__session-actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.accounts-setup__title {
  font-size: clamp(1.2rem, 1.7vw, 1.55rem);
  font-weight: 700;
  letter-spacing: 0;
  line-height: 1.05;
  margin: 0 0 0.15rem;
}

.accounts-setup__lede,
.accounts-setup__item-message,
.accounts-setup__identity,
.accounts-setup__session-status,
.accounts-setup__code-help,
.accounts-setup__copy-status {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.9rem;
  line-height: 1.35;
  margin: 0;
}

.accounts-setup__items {
  display: grid;
  gap: 0.625rem;
}

.accounts-setup__item {
  border-left: 4px solid transparent;
  display: grid;
  gap: 0.75rem;
  padding: 0.85rem 1rem;
}

.accounts-setup__item--connected {
  background: rgba(var(--v-theme-success), 0.04);
  border-left-color: rgb(var(--v-theme-success));
}

.accounts-setup__item--missing {
  background: rgba(var(--v-theme-warning), 0.04);
  border-left-color: rgb(var(--v-theme-warning));
}

.accounts-setup__item-main {
  align-items: start;
  display: grid;
  gap: 0.75rem;
  grid-template-columns: auto minmax(0, 1fr);
}

.accounts-setup__item-title {
  font-size: 1rem;
  font-weight: 720;
  letter-spacing: 0;
  line-height: 1.2;
  margin: 0 0 0.2rem;
}

.accounts-setup__identity {
  font-weight: 700;
  margin-top: 0.25rem;
}

.accounts-setup__session {
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  display: grid;
  gap: 0.65rem;
  padding-top: 0.75rem;
}

.accounts-setup__code-block {
  display: grid;
  gap: 0.25rem;
}

.accounts-setup__code-label {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.75rem;
  font-weight: 750;
  letter-spacing: 0;
  margin: 0;
  text-transform: uppercase;
}

.accounts-setup__code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: clamp(2rem, 6vw, 4rem);
  font-weight: 800;
  letter-spacing: 0;
  line-height: 1;
  margin: 0;
}

.accounts-setup__logs pre {
  background: #111318;
  border-radius: 6px;
  color: #f4f6fb;
  margin: 0.5rem 0 0;
  max-height: 22rem;
  overflow: auto;
  padding: 0.75rem;
  white-space: pre-wrap;
}

@media (max-width: 760px) {
  .accounts-setup__header {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
