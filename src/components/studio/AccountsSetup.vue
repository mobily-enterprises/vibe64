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

    <section class="accounts-setup__section">
      <div class="accounts-setup__section-header">
        <div>
          <h2 class="accounts-setup__section-title">AI runtimes</h2>
          <p class="accounts-setup__section-copy">
            Start with OpenCode. Codex appears when its account is authenticated.
          </p>
        </div>
      </div>

      <div class="accounts-setup__items">
        <v-sheet
          v-for="runtime in runtimeRows"
          :key="runtime.id"
          rounded="lg"
          border
          :class="[
            'accounts-setup__item',
            runtime.ready ? 'accounts-setup__item--connected' : 'accounts-setup__item--missing'
          ]"
        >
          <div class="accounts-setup__item-main">
            <v-icon
              :icon="runtime.ready ? mdiCheckCircle : mdiAlertCircleOutline"
              :color="runtime.ready ? 'success' : 'warning'"
              size="30"
            />
            <div>
              <div class="accounts-setup__item-title-row">
                <h3 class="accounts-setup__item-title">{{ runtime.label }}</h3>
                <v-chip
                  v-if="runtime.default"
                  color="primary"
                  density="comfortable"
                  size="small"
                  variant="tonal"
                >
                  Default
                </v-chip>
                <v-chip
                  v-if="runtime.mode === 'free'"
                  color="success"
                  density="comfortable"
                  size="small"
                  variant="tonal"
                >
                  Free
                </v-chip>
              </div>
              <p class="accounts-setup__item-message">
                {{ runtime.message || runtimeStatusMessage(runtime) }}
              </p>

              <div
                v-if="runtime.id === 'opencode'"
                class="accounts-setup__providers"
              >
                <div class="accounts-setup__provider-header">
                  <span class="accounts-setup__provider-count">
                    {{ openCodeProviderSummary(runtime) }}
                  </span>
                  <v-text-field
                    v-model="providerSearch"
                    class="accounts-setup__provider-search"
                    density="compact"
                    hide-details
                    :prepend-inner-icon="mdiMagnify"
                    placeholder="Search providers or models"
                    single-line
                    variant="outlined"
                  />
                </div>

                <v-alert
                  v-if="providerActionError"
                  class="accounts-setup__provider-action-error"
                  density="compact"
                  type="error"
                  variant="tonal"
                >
                  {{ providerActionError }}
                </v-alert>

                <div class="accounts-setup__provider-list">
                  <div
                    v-for="provider in filteredOpenCodeProviders"
                    :key="provider.id"
                    class="accounts-setup__provider-row"
                  >
                    <div class="accounts-setup__provider-main">
                      <div class="accounts-setup__provider-title-row">
                        <strong>{{ provider.label }}</strong>
                        <v-chip
                          v-if="providerIsTrial(provider)"
                          color="success"
                          density="comfortable"
                          size="small"
                          variant="tonal"
                        >
                          Free try-out
                        </v-chip>
                        <v-chip
                          v-else-if="provider.connected"
                          color="success"
                          density="comfortable"
                          size="small"
                          variant="tonal"
                        >
                          Connected
                        </v-chip>
                        <v-chip
                          v-if="providerCredentialLabel(provider)"
                          color="default"
                          density="comfortable"
                          size="small"
                          variant="tonal"
                        >
                          {{ providerCredentialLabel(provider) }}
                        </v-chip>
                        <v-chip
                          v-if="provider.defaultModelId"
                          class="accounts-setup__provider-model-chip"
                          color="primary"
                          density="comfortable"
                          size="small"
                          :title="`Default model: ${provider.defaultModelId}`"
                          variant="tonal"
                        >
                          {{ providerDefaultModelLabel(provider) }}
                        </v-chip>
                        <v-chip
                          v-for="model in providerMatchedModels(provider)"
                          :key="`${provider.id}:${model.id || model.label}`"
                          class="accounts-setup__provider-model-chip"
                          color="secondary"
                          density="comfortable"
                          size="small"
                          :title="providerModelChipTitle(model)"
                          variant="tonal"
                        >
                          {{ providerModelChipLabel(model) }}
                        </v-chip>
                      </div>
                      <p class="accounts-setup__provider-meta">
                        {{ providerMeta(provider) }}
                      </p>
                    </div>
                    <v-btn
                      v-if="!providerIsTrial(provider)"
                      class="accounts-setup__provider-action"
                      color="primary"
                      size="small"
                      type="button"
                      :disabled="providerAuthAction(provider).disabled"
                      :loading="providerOauthRunningId === provider.id"
                      :variant="provider.connected ? 'tonal' : 'flat'"
                      @click="handleProviderAction(provider)"
                    >
                      {{ providerAuthAction(provider).label }}
                    </v-btn>
                    <v-chip
                      v-else
                      class="accounts-setup__provider-action-chip"
                      color="success"
                      density="comfortable"
                      variant="tonal"
                    >
                      Ready
                    </v-chip>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div
            v-if="runtime.id === 'codex' && !runtime.ready"
            class="accounts-setup__actions"
          >
            <v-btn
              color="primary"
              variant="flat"
              :disabled="oauthChangesDisabled || authSessions.loginDisabled(accountFor('codex'))"
              :loading="authSessions.activeSessionFor('codex')?.status === 'authenticating'"
              @click="authSessions.startBrowserAuth('codex')"
            >
              Auth Codex
            </v-btn>
            <v-btn
              color="primary"
              variant="tonal"
              :disabled="oauthChangesDisabled || authSessions.loginDisabled(accountFor('codex'))"
              @click="authSessions.startDeviceAuth"
            >
              Use code login
            </v-btn>
          </div>
        </v-sheet>
      </div>
    </section>

    <section class="accounts-setup__section">
      <div class="accounts-setup__section-header">
        <div>
          <h2 class="accounts-setup__section-title">Connected accounts</h2>
          <p class="accounts-setup__section-copy">
            GitHub is required for issue, pull request, and merge workflows. Codex is optional.
          </p>
        </div>
      </div>

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
              <div class="accounts-setup__item-title-row">
                <h3 class="accounts-setup__item-title">{{ account.label }}</h3>
                <v-chip
                  :color="account.required ? 'warning' : 'default'"
                  density="comfortable"
                  size="small"
                  variant="tonal"
                >
                  {{ account.required ? "Required" : "Optional" }}
                </v-chip>
              </div>
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
              :disabled="oauthChangesDisabled || authSessions.loginDisabled(account)"
              :loading="authSessions.activeSessionFor(account.id)?.status === 'authenticating'"
              @click="authSessions.startBrowserAuth(account.id)"
            >
              {{ account.id === "github" ? "Auth GitHub" : "Auth Codex" }}
            </v-btn>
            <v-btn
              v-if="account.id === 'codex'"
              color="primary"
              variant="tonal"
              :disabled="oauthChangesDisabled || authSessions.loginDisabled(account)"
              @click="authSessions.startDeviceAuth"
            >
              Use code login
            </v-btn>
            <v-btn
              color="warning"
              variant="tonal"
              :disabled="oauthChangesDisabled || authSessions.authBusy || !account.connected"
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

    <v-dialog
      v-model="providerAuthDialogOpen"
      max-width="34rem"
    >
      <v-card>
        <v-card-title>{{ providerAuthTitle }}</v-card-title>
        <v-card-text>
          <v-text-field
            v-model="providerApiKey"
            autocomplete="off"
            label="API key"
            type="password"
            variant="outlined"
            @keyup.enter="submitProviderAuth"
          />
          <v-alert
            v-if="providerAuthError"
            density="compact"
            type="error"
            variant="tonal"
          >
            {{ providerAuthError }}
          </v-alert>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            :disabled="providerAuthRunning"
            @click="providerAuthDialogOpen = false"
          >
            Cancel
          </v-btn>
          <v-btn
            color="primary"
            variant="flat"
            :disabled="!providerApiKey.trim()"
            :loading="providerAuthRunning"
            @click="submitProviderAuth"
          >
            Save
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
  mdiAlertCircleOutline,
  mdiCheckCircle,
  mdiContentCopy,
  mdiMagnify,
  mdiRefresh
} from "@mdi/js";
import { useVibe64Accounts } from "@/composables/useVibe64Accounts.js";
import { useAccountAuthSessions } from "@/composables/useAccountAuthSessions.js";
import {
  isOpenCodeTrialProvider,
  searchOpenCodeProviders
} from "@/lib/opencodeProviderSearch.js";

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
const status = computed(() => accounts.status || null);
const statusReady = computed(() => status.value?.ready === true);
const providerSearch = ref("");
const providerAuthDialogOpen = ref(false);
const providerAuthError = ref("");
const providerAuthRunning = ref(false);
const providerAuthTarget = ref(null);
const providerApiKey = ref("");
const providerOauthRunningId = ref("");
const providerOauthRefreshToken = ref(0);
const providerActionError = ref("");
const accountRows = computed(() => {
  const rows = Array.isArray(status.value?.accounts) ? status.value.accounts : [];
  return rows.length
    ? rows.slice().sort((left, right) => Number(right.required === true) - Number(left.required === true))
    : [
        {
          connected: false,
          id: "github",
          label: "GitHub",
          message: "GitHub status has not loaded yet.",
          required: true,
          status: "unknown"
        },
        {
          connected: false,
          id: "codex",
          label: "Codex",
          message: "Codex status has not loaded yet.",
          required: false,
          status: "unknown"
        }
      ];
});
const runtimeRows = computed(() => {
  const rows = Array.isArray(status.value?.agentRuntimes) ? status.value.agentRuntimes : [];
  return rows.length
    ? rows
    : [
        {
          available: true,
          connected: true,
          default: true,
          id: "opencode",
          label: "OpenCode",
          message: "OpenCode status has not loaded yet.",
          mode: "free",
          ready: true,
          runtime: "opencode",
          status: "available"
        },
        {
          available: false,
          connected: false,
          id: "codex",
          label: "Codex",
          message: "Codex status has not loaded yet.",
          mode: "optional",
          ready: false,
          runtime: "codex",
          status: "unknown"
        }
      ];
});
const openCodeRuntime = computed(() => runtimeRows.value.find((runtime) => runtime.id === "opencode") || null);
const openCodeRemote = computed(() => Boolean(
  openCodeRuntime.value?.remote === true ||
  String(openCodeRuntime.value?.runtimeLocation || "").trim() === "remote"
));
const openCodeProviders = computed(() => {
  const providers = openCodeRuntime.value?.providers;
  return Array.isArray(providers) ? providers : [];
});
const filteredOpenCodeProviders = computed(() => {
  return searchOpenCodeProviders(openCodeProviders.value, providerSearch.value, {
    limit: 12,
    modelMatchLimit: 3
  });
});
const providerAuthTitle = computed(() => {
  return providerAuthTarget.value?.label
    ? `OpenCode: ${providerAuthTarget.value.label}`
    : "OpenCode provider";
});
const authSessions = useAccountAuthSessions(accounts, {
  accountRows
});
const errorMessage = computed(() => authSessions.errorMessage);
const oauthChangesDisabled = computed(() => Boolean(
  status.value?.remote === true ||
  String(status.value?.runtimeLocation || "").trim() === "remote"
));

function accountFor(accountId = "") {
  return accountRows.value.find((account) => account.id === accountId) || {
    connected: false,
    id: accountId,
    label: accountId,
    required: false,
    status: "unknown"
  };
}

function accountStatusMessage(account = {}) {
  return account.connected ? `${account.label} is connected.` : `${account.label} is not connected.`;
}

function runtimeStatusMessage(runtime = {}) {
  return runtime.ready ? `${runtime.label} is available.` : `${runtime.label} is not available.`;
}

function openCodeProviderSummary(runtime = {}) {
  const providerCount = Array.isArray(runtime.providers) ? runtime.providers.length : 0;
  const connectedCount = Number(runtime.connectedProviderCount || 0);
  if (!providerCount) {
    return "Providers loading";
  }
  return connectedCount
    ? `${connectedCount} connected / ${providerCount} providers`
    : `${providerCount} providers`;
}

function providerMeta(provider = {}) {
  const modelCount = Number(provider.modelCount || provider.models?.length || 0);
  if (modelCount > 0) {
    return modelCount === 1 ? "1 model" : `${modelCount} models`;
  }
  return provider.id || "Provider";
}

function providerDefaultModelLabel(provider = {}) {
  return `Default: ${provider.defaultModelId}`;
}

function providerCredentialLabel(provider = {}) {
  if (provider.connected !== true) {
    return "";
  }
  if (provider.authType === "oauth") {
    return "OAuth";
  }
  if (provider.authType === "api") {
    return "API key";
  }
  if (provider.authType === "wellknown") {
    return "Built-in";
  }
  return "";
}

function providerIsTrial(provider = {}) {
  return isOpenCodeTrialProvider(provider);
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function providerConnected(providerId = "") {
  const normalizedProviderId = String(providerId || "").trim();
  return Boolean(normalizedProviderId) && openCodeProviders.value.some((provider) => {
    return String(provider.id || "").trim() === normalizedProviderId && provider.connected === true;
  });
}

function providerHasAuthMethod(provider = {}, type = "") {
  const authType = String(type || "").trim().toLowerCase();
  return Array.isArray(provider.authMethods) && provider.authMethods.some((method) => {
    return String(method?.type || "").trim().toLowerCase() === authType;
  });
}

function providerOAuthMethodIndex(provider = {}) {
  return Array.isArray(provider.authMethods)
    ? provider.authMethods.findIndex((method) => String(method?.type || "").trim().toLowerCase() === "oauth")
    : -1;
}

function providerAuthAction(provider = {}) {
  if (providerIsTrial(provider)) {
    return {
      disabled: true,
      kind: "trial",
      label: "Ready"
    };
  }
  if (provider.authType === "oauth") {
    const methodIndex = providerOAuthMethodIndex(provider);
    if (methodIndex < 0) {
      return {
        disabled: true,
        kind: "disabled",
        label: "OAuth unavailable"
      };
    }
    return openCodeRemote.value
      ? {
          disabled: true,
          kind: "disabled",
          label: "OAuth disabled"
        }
      : {
          disabled: false,
          kind: "oauth",
          label: "Reconnect",
          methodIndex
        };
  }
  if (provider.authType === "api") {
    return {
      disabled: false,
      kind: "api",
      label: "Update key"
    };
  }
  const oauthMethodIndex = providerOAuthMethodIndex(provider);
  if (oauthMethodIndex >= 0 && !openCodeRemote.value) {
    return {
      disabled: false,
      kind: "oauth",
      label: "Login",
      methodIndex: oauthMethodIndex
    };
  }
  if (oauthMethodIndex >= 0 && !providerHasAuthMethod(provider, "api")) {
    return {
      disabled: true,
      kind: "disabled",
      label: "OAuth disabled"
    };
  }
  return {
    disabled: false,
    kind: "api",
    label: provider.connected ? "Update key" : "Add key"
  };
}

function providerMatchedModels(provider = {}) {
  const defaultModelId = String(provider.defaultModelId || "").trim().toLowerCase();
  const models = Array.isArray(provider.matchedModels) ? provider.matchedModels : [];
  return models.filter((model) => String(model.id || "").trim().toLowerCase() !== defaultModelId);
}

function providerModelChipLabel(model = {}) {
  return model.id || model.label || "Model";
}

function providerModelChipTitle(model = {}) {
  const id = String(model.id || "").trim();
  const label = String(model.label || "").trim();
  if (id && label && id !== label) {
    return `${label} (${id})`;
  }
  return id || label || "Model";
}

function openProviderAuth(provider = {}) {
  providerAuthTarget.value = provider;
  providerApiKey.value = "";
  providerAuthError.value = "";
  providerActionError.value = "";
  providerAuthDialogOpen.value = true;
}

function handleProviderAction(provider = {}) {
  const action = providerAuthAction(provider);
  if (action.disabled) {
    return;
  }
  if (action.kind === "oauth") {
    void startProviderOAuth(provider, action);
    return;
  }
  openProviderAuth(provider);
}

async function startProviderOAuth(provider = {}, action = {}) {
  const providerId = String(provider.id || "").trim();
  if (!providerId || providerOauthRunningId.value) {
    return;
  }
  const browserWindow = typeof window === "undefined" ? null : window.open("about:blank", "_blank");
  if (browserWindow) {
    browserWindow.opener = null;
  }
  providerOauthRunningId.value = providerId;
  providerActionError.value = "";
  try {
    const result = await accounts.startOpenCodeProviderOAuth(providerId, action.methodIndex);
    if (result?.ok === false) {
      browserWindow?.close();
      providerActionError.value = result.error || "OpenCode OAuth login could not start.";
      return;
    }
    const authUrl = String(result?.authorization?.url || "").trim();
    if (authUrl && browserWindow) {
      browserWindow.location.href = authUrl;
    } else if (authUrl && typeof window !== "undefined") {
      window.open(authUrl, "_blank", "noopener,noreferrer");
    } else {
      browserWindow?.close();
    }
    void refreshProviderStatusAfterOAuth(providerId, browserWindow);
  } catch (error) {
    browserWindow?.close();
    providerActionError.value = String(error?.message || error || "OpenCode OAuth login could not start.");
  } finally {
    providerOauthRunningId.value = "";
  }
}

async function refreshProviderStatusAfterOAuth(providerId = "", browserWindow = null) {
  if (typeof window === "undefined") {
    return;
  }
  const token = providerOauthRefreshToken.value + 1;
  providerOauthRefreshToken.value = token;
  for (let attempt = 0; attempt < 45 && providerOauthRefreshToken.value === token; attempt += 1) {
    await delay(attempt === 0 ? 2500 : 2000);
    await accounts.refresh();
    if (providerConnected(providerId)) {
      return;
    }
    if (browserWindow?.closed && attempt >= 2) {
      return;
    }
  }
}

async function submitProviderAuth() {
  const providerId = String(providerAuthTarget.value?.id || "").trim();
  const apiKey = providerApiKey.value.trim();
  if (!providerId || !apiKey || providerAuthRunning.value) {
    return;
  }
  providerAuthRunning.value = true;
  providerAuthError.value = "";
  try {
    const result = await accounts.setOpenCodeProviderAuth(providerId, apiKey);
    if (result?.ok === false) {
      providerAuthError.value = result.error || "OpenCode provider key could not be saved.";
      return;
    }
    providerAuthDialogOpen.value = false;
    providerApiKey.value = "";
  } catch (error) {
    providerAuthError.value = String(error?.message || error || "OpenCode provider key could not be saved.");
  } finally {
    providerAuthRunning.value = false;
  }
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
  providerOauthRefreshToken.value += 1;
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

.accounts-setup__section {
  display: grid;
  gap: 0.625rem;
}

.accounts-setup__section-header {
  align-items: end;
  display: flex;
  gap: 1rem;
  justify-content: space-between;
}

.accounts-setup__section-title {
  font-size: 1rem;
  font-weight: 740;
  letter-spacing: 0;
  line-height: 1.2;
  margin: 0 0 0.15rem;
}

.accounts-setup__section-copy {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.86rem;
  line-height: 1.35;
  margin: 0;
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
  margin: 0;
}

.accounts-setup__item-title-row {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  margin: 0 0 0.2rem;
}

.accounts-setup__identity {
  font-weight: 700;
  margin-top: 0.25rem;
}

.accounts-setup__providers {
  display: grid;
  gap: 0.55rem;
  margin-top: 0.8rem;
}

.accounts-setup__provider-header {
  align-items: center;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
}

.accounts-setup__provider-count,
.accounts-setup__provider-meta {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.78rem;
  line-height: 1.3;
  margin: 0;
}

.accounts-setup__provider-search {
  flex: 0 1 18rem;
}

.accounts-setup__provider-list {
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  display: grid;
}

.accounts-setup__provider-row {
  align-items: center;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  display: grid;
  gap: 0.75rem;
  grid-template-columns: minmax(0, 1fr) auto;
  min-height: 3.65rem;
  padding: 0.5rem 0;
}

.accounts-setup__provider-main {
  min-width: 0;
}

.accounts-setup__provider-title-row {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  min-width: 0;
}

.accounts-setup__provider-title-row strong {
  font-size: 0.9rem;
  line-height: 1.2;
}

.accounts-setup__provider-action {
  min-width: 5.7rem;
}

.accounts-setup__provider-action-chip {
  justify-self: end;
  min-width: 5.7rem;
}

.accounts-setup__provider-model-chip {
  max-width: min(18rem, 100%);
}

.accounts-setup__provider-model-chip :deep(.v-chip__content) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

  .accounts-setup__section-header {
    align-items: stretch;
    flex-direction: column;
  }

  .accounts-setup__provider-header,
  .accounts-setup__provider-row {
    align-items: stretch;
    grid-template-columns: minmax(0, 1fr);
  }

  .accounts-setup__provider-header {
    flex-direction: column;
  }

  .accounts-setup__provider-search {
    flex-basis: auto;
    width: 100%;
  }
}
</style>
