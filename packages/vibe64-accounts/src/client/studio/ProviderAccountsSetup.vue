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
          :loading="accountsLoading"
          :prepend-icon="mdiRefresh"
          @click="refreshStatus"
        >
          Refresh
        </v-btn>
        <v-btn
          v-if="statusReady && showContinue"
          color="primary"
          :disabled="!accountsReadyForActions"
          variant="flat"
          @click="emit('continue')"
        >
          {{ continueLabel }}
        </v-btn>
      </div>
    </header>

    <v-alert
      v-if="errorMessage"
      class="accounts-setup__notice"
      type="error"
      variant="tonal"
      border="start"
    >
      {{ errorMessage }}
    </v-alert>

    <v-alert
      v-if="!actionsEnabled && actionsDisabledMessage"
      class="accounts-setup__notice"
      type="info"
      variant="tonal"
      border="start"
    >
      {{ actionsDisabledMessage }}
    </v-alert>

    <v-progress-linear
      v-if="accountsLoading && accountRows.length < 1"
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
          account.connected ? 'accounts-setup__item--connected' : 'accounts-setup__item--missing',
          !accountsReadyForActions ? 'accounts-setup__item--busy' : ''
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
            <p
              v-else-if="account.previousUsername"
              class="accounts-setup__identity"
            >
              Previously linked: @{{ account.previousUsername }}
            </p>
          </div>
          <div
            v-if="accountActiveSession(account)"
            class="accounts-setup__session-header-actions"
          >
            <v-btn
              color="primary"
              :disabled="!accountsReadyForActions || !authTerminalAvailable(accountActiveSession(account))"
              variant="tonal"
              :prepend-icon="mdiConsoleLine"
              @click="toggleAuthTerminal(accountActiveSession(account))"
            >
              {{ authTerminalVisible(accountActiveSession(account)) ? 'Hide terminal' : 'View terminal' }}
            </v-btn>
            <v-btn
              color="warning"
              variant="tonal"
              :disabled="!accountsReadyForActions || !accountActiveSession(account)?.id"
              @click="cancelSession(accountActiveSession(account))"
            >
              Cancel login
            </v-btn>
          </div>
        </div>

        <div
          v-if="!accountActiveSession(account)"
          class="accounts-setup__actions"
        >
          <div
            v-if="requiresGitIdentity(account)"
            class="accounts-setup__identity-fields"
          >
            <v-text-field
              v-model="gitIdentityInput(account).name"
              autocomplete="name"
              density="compact"
              hide-details="auto"
              label="Git user.name"
              required
              :disabled="!accountsReadyForActions"
              variant="outlined"
            />
            <v-text-field
              v-model="gitIdentityInput(account).email"
              autocomplete="email"
              density="compact"
              hide-details="auto"
              label="Git user.email"
              required
              type="email"
              :disabled="!accountsReadyForActions"
              variant="outlined"
            />
          </div>
          <v-btn
            color="primary"
            variant="flat"
            :disabled="!accountsReadyForActions || accountLoginDisabled(account)"
            :loading="accountActiveSession(account)?.status === 'authenticating'"
            @click="startAccountAuth(account)"
          >
            {{ primaryAuthLabel(account) }}
          </v-btn>
          <v-btn
            color="warning"
            variant="tonal"
            :disabled="!accountsReadyForActions || authBusy || !account.connected"
            :loading="logoutAccountId === account.id"
            @click="logoutAccount(account.id)"
          >
            Logout
          </v-btn>
          <v-btn
            v-if="accountSupportsApiKeyAuth(account)"
            color="primary"
            variant="tonal"
            :disabled="!accountsReadyForActions || authBusy"
            @click="toggleApiKeyForm(account)"
          >
            Use OpenAI API key
          </v-btn>
          <div
            v-if="accountSupportsApiKeyAuth(account) && apiKeyFormVisible(account)"
            class="accounts-setup__api-key-form"
          >
            <v-text-field
              v-model="apiKeyInput(account).value"
              autocomplete="off"
              density="compact"
              hide-details="auto"
              label="OpenAI API key"
              required
              type="password"
              :disabled="!accountsReadyForActions"
              variant="outlined"
            />
            <v-btn
              color="primary"
              variant="flat"
              :disabled="!accountsReadyForActions || apiKeyLoginDisabled(account)"
              @click="startAccountApiKeyAuth(account)"
            >
              Login with API key
            </v-btn>
          </div>
        </div>

        <div
          v-if="accountActiveSession(account)"
          class="accounts-setup__session"
        >
          <div
            v-if="codexSettingsStepVisible(accountActiveSession(account))"
            class="accounts-setup__codex-instructions"
          >
            <div class="accounts-setup__codex-instruction-copy">
              <p class="accounts-setup__codex-instruction-title">Before starting code login</p>
              <div class="accounts-setup__codex-settings-step">
                <span class="accounts-setup__step-number">1</span>
                <div class="accounts-setup__step-body">
                  <p class="accounts-setup__step-title">Open Codex settings</p>
                  <p class="accounts-setup__code-help">
                    Turn on Enable device code authorization for Codex.
                  </p>
                  <v-btn
                    class="accounts-setup__codex-settings-link"
                    color="primary"
                    :href="CHATGPT_SECURITY_SETTINGS_URL"
                    :prepend-icon="mdiOpenInNew"
                    rel="noopener"
                    size="small"
                    target="_blank"
                    variant="tonal"
                  >
                    Open Codex settings
                  </v-btn>
                </div>
              </div>
              <p class="accounts-setup__code-help">
                If your ChatGPT workspace manages this setting, ask a workspace admin to enable device code authorization.
              </p>
              <div class="accounts-setup__step-footer">
                <span aria-hidden="true" />
                <div class="accounts-setup__step-actions accounts-setup__step-actions--next">
                  <v-btn
                    color="primary"
                    :disabled="!accountsReadyForActions"
                    variant="flat"
                    @click="setCodexAuthStep(accountActiveSession(account), 'authorize')"
                  >
                    Next step
                  </v-btn>
                </div>
              </div>
            </div>
            <img
              alt="ChatGPT Settings Security screen with Enable device code authorization for Codex switched on"
              class="accounts-setup__codex-instruction-image"
              :src="codexDeviceSettingsImage"
            >
          </div>

          <div
            v-else
            class="accounts-setup__codex-instructions"
          >
            <div class="accounts-setup__codex-instruction-copy">
              <div
                v-if="authSessionUserCode(accountActiveSession(account))"
                class="accounts-setup__code-block"
              >
                <p class="accounts-setup__code-label">One-time code</p>
                <p class="accounts-setup__code">{{ authSessionUserCode(accountActiveSession(account)) }}</p>
                <p
                  v-if="accountActiveSession(account)?.mode === 'device'"
                  class="accounts-setup__code-help"
                >
                  Copy this code, then finalise authorization in your browser. Keep this page open until Vibe64 shows the account as connected.
                </p>
              </div>

              <div class="accounts-setup__session-actions accounts-setup__session-actions--primary">
                <v-btn
                  v-if="authSessionUserCode(accountActiveSession(account))"
                  color="primary"
                  :disabled="!accountsReadyForActions"
                  variant="tonal"
                  :prepend-icon="mdiContentCopy"
                  @click="copyAuthCode(accountActiveSession(account))"
                >
                  <span class="accounts-setup__button-step">2</span>
                  <span>Copy one-time code</span>
                </v-btn>
                <v-btn
                  v-if="accountActiveSession(account)?.authUrl"
                  color="primary"
                  :disabled="!accountsReadyForActions"
                  variant="tonal"
                  :prepend-icon="mdiOpenInNew"
                  @click="openAuthUrl(accountActiveSession(account))"
                >
                  <span class="accounts-setup__button-step">3</span>
                  <span>Finalise authorization</span>
                </v-btn>
              </div>

              <p
                v-if="authCopyStatus[accountActiveSession(account)?.id]"
                class="accounts-setup__copy-status"
              >
                {{ authCopyStatus[accountActiveSession(account).id] }}
              </p>

              <p class="accounts-setup__session-status">
                {{ sessionStatusMessage(accountActiveSession(account)) }}
              </p>

              <div
                v-if="codexAuthorizeStepVisible(accountActiveSession(account))"
                class="accounts-setup__step-footer"
              >
                <div class="accounts-setup__step-actions">
                  <v-btn
                    color="primary"
                    :disabled="!accountsReadyForActions"
                    variant="flat"
                    @click="setCodexAuthStep(accountActiveSession(account), 'settings')"
                  >
                    Previous step
                  </v-btn>
                </div>
                <span aria-hidden="true" />
              </div>

              <details
                v-if="loginOutputVisible(accountActiveSession(account))"
                class="accounts-setup__logs"
                :open="accountActiveSession(account)?.status === 'failed'"
              >
                <summary>Show login output</summary>
                <pre>{{ accountActiveSession(account).output }}</pre>
              </details>
            </div>

            <img
              v-if="codexAuthorizeStepVisible(accountActiveSession(account))"
              alt="Codex CLI device authorization page with one-time code entry fields"
              class="accounts-setup__codex-instruction-image"
              :src="codexDeviceAuthorizeImage"
            >
          </div>

          <div
            v-if="authTerminalVisible(accountActiveSession(account))"
            class="accounts-setup__terminal"
          >
            <Vibe64Terminal
              close-label="Hide"
              :collapsible="false"
              :command-preview="authTerminal.terminalCommandPreview"
              :error="authTerminalError(accountActiveSession(account))"
              presentation="inline"
              :status="authTerminal.terminalStatus"
              subtitle="Use this only if Codex asks for terminal input."
              :terminal="authTerminal"
              title="Codex login terminal"
              :visible="true"
              @close="closeAuthTerminal"
            />
          </div>
        </div>
      </v-sheet>
    </div>
  </section>
</template>

<script setup>
import {
  mdiAlertCircleOutline,
  mdiCheckCircle,
  mdiConsoleLine,
  mdiContentCopy,
  mdiOpenInNew,
  mdiRefresh
} from "@mdi/js";
import codexDeviceAuthorizeImage from "/src/assets/codex-device-code-authorize.png";
import codexDeviceSettingsImage from "/src/assets/codex-device-code-settings.png";
import Vibe64Terminal from "/src/components/studio/Vibe64Terminal.vue";
import {
  useProviderAccountsSetup
} from "../composables/useProviderAccountsSetup.js";

const props = defineProps({
  accounts: {
    required: true,
    type: Object
  },
  actionsDisabledMessage: {
    default: "",
    type: String
  },
  actionsEnabled: {
    default: true,
    type: Boolean
  },
  accountRows: {
    default: () => [],
    type: Array
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
    default: "",
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
  statusLoaded: {
    default: true,
    type: Boolean
  },
  title: {
    default: "Accounts",
    type: String
  }
});

const emit = defineEmits(["back", "continue"]);

const {
  CHATGPT_SECURITY_SETTINGS_URL,
  accountActiveSession,
  accountLoginDisabled,
  accountRows,
  accountStatusMessage,
  accountSupportsApiKeyAuth,
  accountsLoading,
  accountsReadyForActions,
  apiKeyFormVisible,
  apiKeyInput,
  apiKeyLoginDisabled,
  authSessionUserCode,
  authBusy,
  authCopyStatus,
  authTerminal,
  authTerminalAvailable,
  authTerminalError,
  authTerminalVisible,
  cancelSession,
  closeAuthTerminal,
  codexAuthorizeStepVisible,
  codexSettingsStepVisible,
  copyAuthCode,
  errorMessage,
  gitIdentityInput,
  loginOutputVisible,
  logoutAccount,
  logoutAccountId,
  openAuthUrl,
  primaryAuthLabel,
  requiresGitIdentity,
  refreshStatus,
  sessionStatusMessage,
  setCodexAuthStep,
  startAccountApiKeyAuth,
  startAccountAuth,
  statusReady,
  toggleApiKeyForm,
  toggleAuthTerminal
} = useProviderAccountsSetup(props);
</script>

<style scoped>
.accounts-setup {
  display: grid;
  gap: 0.9rem;
  width: 100%;
}

.accounts-setup__header,
.accounts-setup__notice,
.accounts-setup__items {
  margin-inline: auto;
  max-width: 68rem;
  width: 100%;
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

.accounts-setup__identity-fields {
  display: grid;
  gap: 0.5rem;
  grid-template-columns: repeat(2, minmax(12rem, 1fr));
  min-width: min(32rem, 100%);
}

.accounts-setup__api-key-form {
  align-items: start;
  display: grid;
  flex-basis: 100%;
  gap: 0.5rem;
  grid-template-columns: minmax(14rem, 1fr) auto;
  max-width: 42rem;
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
  grid-template-columns: auto minmax(0, 1fr) auto;
}

.accounts-setup__session-header-actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-self: end;
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

.accounts-setup__codex-instructions {
  align-items: start;
  background: rgba(var(--v-theme-primary), 0.04);
  border: 1px solid rgba(var(--v-theme-primary), 0.16);
  border-radius: 8px;
  display: grid;
  gap: 1rem;
  grid-template-columns: minmax(0, 1fr) minmax(14rem, 21rem);
  padding: 0.85rem;
}

.accounts-setup__codex-instruction-copy {
  display: grid;
  gap: 0.45rem;
}

.accounts-setup__codex-instruction-title {
  font-size: 0.92rem;
  font-weight: 750;
  line-height: 1.25;
  margin: 0;
}

.accounts-setup__codex-settings-step {
  align-items: start;
  display: grid;
  gap: 0.65rem;
  grid-template-columns: auto minmax(0, 1fr);
}

.accounts-setup__step-number,
.accounts-setup__button-step {
  align-items: center;
  background: rgba(var(--v-theme-primary), 0.14);
  border-radius: 999px;
  color: rgb(var(--v-theme-primary));
  display: inline-flex;
  font-weight: 800;
  height: 1.65rem;
  justify-content: center;
  line-height: 1;
  width: 1.65rem;
}

.accounts-setup__button-step {
  background: rgba(var(--v-theme-on-primary), 0.18);
  color: currentColor;
  height: 1.35rem;
  margin-inline-end: 0.35rem;
  width: 1.35rem;
}

.accounts-setup__step-body {
  display: grid;
  gap: 0.35rem;
  min-width: 0;
}

.accounts-setup__step-title {
  font-size: 0.92rem;
  font-weight: 760;
  line-height: 1.25;
  margin: 0;
}

.accounts-setup__codex-settings-link {
  justify-self: start;
}

.accounts-setup__step-actions,
.accounts-setup__step-nav {
  align-items: center;
  display: flex;
  gap: 0.5rem;
}

.accounts-setup__step-footer {
  align-items: center;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
  margin-top: 0.3rem;
}

.accounts-setup__step-actions--next {
  grid-column: 1;
  justify-content: flex-end;
}

.accounts-setup__step-nav--previous {
  justify-content: flex-start;
}

.accounts-setup__codex-instruction-image {
  align-self: start;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.18);
  border-radius: 8px;
  display: block;
  max-width: 100%;
  width: 21rem;
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

.accounts-setup__session-actions--primary {
  align-items: stretch;
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

.accounts-setup__terminal {
  min-width: 0;
}

.accounts-setup__terminal :deep(.vibe64-terminal-frame__host) {
  height: clamp(16rem, 42vh, 30rem);
}

@media (max-width: 760px) {
  .accounts-setup__header {
    align-items: stretch;
    flex-direction: column;
  }

  .accounts-setup__identity-fields {
    grid-template-columns: 1fr;
  }

  .accounts-setup__api-key-form {
    grid-template-columns: 1fr;
  }

  .accounts-setup__codex-instructions {
    grid-template-columns: 1fr;
  }

  .accounts-setup__codex-instruction-image {
    width: min(100%, 18rem);
  }

  .accounts-setup__item-main {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .accounts-setup__session-header-actions {
    grid-column: 2;
    justify-self: start;
  }

  .accounts-setup__step-footer {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
